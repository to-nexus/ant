/**
 * Credentials Store
 * 
 * User-level 인증 정보를 암호화하여 저장/관리합니다.
 * 
 * 파일 위치: workspaces/{org}/{user}/.ant/credentials.json
 * 암호화: AES-256-GCM
 * 권한: 0o600 (owner만 읽기/쓰기)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { UserContext } from '../../core/types/user';
import { logger } from '../logger';
import { 
  UserCredentials, 
  GitHubCredentials, 
  FigmaCredentials, 
  LinearCredentials, 
  SlackCredentials,
  ServiceType 
} from './types';

export class CredentialsStore {
  private static loggedKeySource: Set<string> = new Set();

  private readonly workspaceRoot: string;
  private readonly encryptionKey: Buffer;
  
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.encryptionKey = this.loadEncryptionKey();
  }
  
  /**
   * Get all credentials for user
   */
  async getAll(userContext: UserContext): Promise<UserCredentials> {
    const credentialsPath = this.getCredentialsPath(userContext);
    
    if (!fs.existsSync(credentialsPath)) {
      return {};
    }
    
    try {
      const encrypted = await fs.promises.readFile(credentialsPath, 'utf-8');
      const decrypted = this.decrypt(encrypted);
      return JSON.parse(decrypted);
    } catch (error: any) {
      logger.error('Error reading credentials', {
        component: 'CredentialsStore',
        organizationId: userContext.organizationId,
        userId: userContext.userId
      }, error);
      
      if (this.isDecryptionError(error)) {
        logger.warn('Corrupted credentials file detected; deleting', {
          component: 'CredentialsStore',
          organizationId: userContext.organizationId,
          userId: userContext.userId
        }, { credentialsPath });
        await fs.promises.unlink(credentialsPath);
      }
      
      return {};
    }
  }
  
  /**
   * Get credentials for specific service
   */
  async get<T extends GitHubCredentials | FigmaCredentials | LinearCredentials | SlackCredentials>(
    userContext: UserContext,
    service: ServiceType
  ): Promise<T | undefined> {
    const credPath = this.getCredentialsPath(userContext);
    logger.debug(`Getting ${service} credentials`, {
      component: 'CredentialsStore',
      organizationId: userContext.organizationId,
      userId: userContext.userId
    }, { credPath });
    
    const all = await this.getAll(userContext);
    const result = all[service] as T | undefined;
    logger.debug(`Found ${service}: ${result ? 'YES' : 'NO'}`, {
      component: 'CredentialsStore',
      organizationId: userContext.organizationId,
      userId: userContext.userId
    });
    
    return result;
  }
  
  /**
   * Set credentials for specific service
   */
  async set<T extends GitHubCredentials | FigmaCredentials | LinearCredentials | SlackCredentials>(
    userContext: UserContext,
    service: ServiceType,
    credentials: Omit<T, 'updatedAt'>
  ): Promise<void> {
    const credPath = this.getCredentialsPath(userContext);
    logger.info(`Setting ${service} credentials`, {
      component: 'CredentialsStore',
      organizationId: userContext.organizationId,
      userId: userContext.userId
    }, { credPath });
    
    const all = await this.getAll(userContext);
    
    all[service] = {
      ...credentials,
      updatedAt: new Date().toISOString()
    } as any;
    
    await this.saveAll(userContext, all);
    logger.info(`✅ ${service} credentials saved`, {
      component: 'CredentialsStore',
      organizationId: userContext.organizationId,
      userId: userContext.userId
    }, { credPath });
  }
  
  /**
   * Delete credentials for specific service
   */
  async delete(userContext: UserContext, service: ServiceType): Promise<void> {
    const all = await this.getAll(userContext);
    delete all[service];
    await this.saveAll(userContext, all);
    logger.info(`✅ ${service} credentials deleted`, {
      component: 'CredentialsStore',
      organizationId: userContext.organizationId,
      userId: userContext.userId
    });
  }
  
  /**
   * Check if credentials exist for service
   */
  async has(userContext: UserContext, service: ServiceType): Promise<boolean> {
    const all = await this.getAll(userContext);
    return !!all[service];
  }
  
  /**
   * List all configured services
   */
  async list(userContext: UserContext): Promise<ServiceType[]> {
    const all = await this.getAll(userContext);
    return Object.keys(all) as ServiceType[];
  }
  
  /**
   * Delete all credentials
   */
  async deleteAll(userContext: UserContext): Promise<void> {
    const credentialsPath = this.getCredentialsPath(userContext);
    
    if (fs.existsSync(credentialsPath)) {
      await fs.promises.unlink(credentialsPath);
      logger.info('✅ All credentials deleted', {
        component: 'CredentialsStore',
        organizationId: userContext.organizationId,
        userId: userContext.userId
      }, { credentialsPath });
    }
  }
  
  /**
   * Save all credentials (encrypted)
   */
  private async saveAll(userContext: UserContext, credentials: UserCredentials): Promise<void> {
    const credentialsPath = this.getCredentialsPath(userContext);
    
    // Create directory if not exists
    await fs.promises.mkdir(path.dirname(credentialsPath), { recursive: true });
    
    // Encrypt and save
    const json = JSON.stringify(credentials, null, 2);
    const encrypted = this.encrypt(json);
    
    await fs.promises.writeFile(credentialsPath, encrypted, { mode: 0o600 });
  }
  
  /**
   * Get credentials file path
   */
  private getCredentialsPath(userContext: UserContext): string {
    return path.join(
      this.workspaceRoot,
      userContext.organizationId,
      userContext.userId,
      '.ant',
      'credentials.json'
    );
  }
  
  /**
   * Load encryption key from environment or file
   * Priority: 1. ANT_ENCRYPTION_KEY env var, 2. workspaces/.ant/encryption.key
   * 
   * AES-256-GCM requires 32-byte (256-bit) key = 64 hex characters
   */
  private loadEncryptionKey(): Buffer {
    // 1. Try environment variable first (highest priority)
    const keyString = process.env.ANT_ENCRYPTION_KEY?.trim();
    
    if (keyString) {
      // Validate key length: AES-256 requires 64 hex chars (32 bytes)
      if (keyString.length !== 64) {
        logger.error(`❌ ANT_ENCRYPTION_KEY has invalid length: ${keyString.length} (expected 64 hex chars)`, { component: 'CredentialsStore' });
        logger.error('   Generate a valid key with: openssl rand -hex 32', { component: 'CredentialsStore' });
        // Fall through to file-based or auto-generated key
      } else if (!/^[0-9a-fA-F]+$/.test(keyString)) {
        logger.error('❌ ANT_ENCRYPTION_KEY contains invalid characters (expected hex only)', { component: 'CredentialsStore' });
        // Fall through to file-based or auto-generated key
      } else {
        // ✅ Valid key from environment
        if (!CredentialsStore.loggedKeySource.has('env')) {
          CredentialsStore.loggedKeySource.add('env');
          logger.info('✅ Using ANT_ENCRYPTION_KEY from environment', { component: 'CredentialsStore' });
        }
        return Buffer.from(keyString, 'hex');
      }
    }
    
    // 2. Try file in workspaces/.ant/encryption.key
    const keyFilePath = path.join(this.workspaceRoot, '.ant', 'encryption.key');
    
    try {
      if (fs.existsSync(keyFilePath)) {
        const keyHex = fs.readFileSync(keyFilePath, 'utf8').trim();
        if (!CredentialsStore.loggedKeySource.has('file')) {
          CredentialsStore.loggedKeySource.add('file');
          logger.info('✅ Using encryption key from file', { component: 'CredentialsStore' }, { keyFilePath });
        }
        return Buffer.from(keyHex, 'hex');
      }
      
      // 3. Generate new key as fallback
      logger.warn('⚠️  No encryption key found; generating new one', { component: 'CredentialsStore' }, { keyFilePath });
      logger.warn('⚠️  Consider setting ANT_ENCRYPTION_KEY in environment for stable credentials', { component: 'CredentialsStore' });
      
      const key = crypto.randomBytes(32);
      const keyHex = key.toString('hex');
      fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
      fs.writeFileSync(keyFilePath, keyHex, { mode: 0o600 });
      
      logger.warn('✅ Generated new encryption key file', { component: 'CredentialsStore' }, { keyFilePath });
      logger.warn('ℹ️  Set ANT_ENCRYPTION_KEY to persist credentials across restarts', { component: 'CredentialsStore' });
      
      return key;
    } catch (error) {
      logger.error('❌ Failed to load/save encryption key', { component: 'CredentialsStore' }, error);
      logger.error('⚠️  Using temporary key (credentials will not persist!)', { component: 'CredentialsStore' });
      return crypto.randomBytes(32);
    }
  }
  
  /**
   * Encrypt text using AES-256-GCM
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }
  
  /**
   * Decrypt text using AES-256-GCM
   */
  private decrypt(encrypted: string): string {
    const parts = encrypted.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
  
  /**
   * Check if error is decryption error (key mismatch, corrupted data, etc.)
   */
  private isDecryptionError(error: any): boolean {
    return error.message?.includes('Unsupported state') ||
           error.message?.includes('unable to authenticate data') ||
           error.message?.includes('bad decrypt') ||
           error.code === 'ERR_CRYPTO_INVALID_KEYLEN';  // Invalid key length
  }
}

