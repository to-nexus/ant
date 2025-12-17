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
import { 
  UserCredentials, 
  GitHubCredentials, 
  FigmaCredentials, 
  LinearCredentials, 
  SlackCredentials,
  ServiceType 
} from './types';

export class CredentialsStore {
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
      console.error('[CredentialsStore] Error reading credentials:', error);
      
      if (this.isDecryptionError(error)) {
        console.warn('[CredentialsStore] Corrupted credentials file, deleting...');
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
    console.log(`[CredentialsStore] Getting ${service} credentials for ${userContext.userId}@${userContext.organizationId}`);
    const credPath = this.getCredentialsPath(userContext);
    console.log(`[CredentialsStore] Path: ${credPath}`);
    
    const all = await this.getAll(userContext);
    const result = all[service] as T | undefined;
    console.log(`[CredentialsStore] Found ${service}:`, result ? 'YES' : 'NO');
    
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
    console.log(`[CredentialsStore] Setting ${service} credentials for ${userContext.userId}@${userContext.organizationId}`);
    const credPath = this.getCredentialsPath(userContext);
    console.log(`[CredentialsStore] Path: ${credPath}`);
    
    const all = await this.getAll(userContext);
    
    all[service] = {
      ...credentials,
      updatedAt: new Date().toISOString()
    } as any;
    
    await this.saveAll(userContext, all);
    console.log(`[CredentialsStore] ✅ ${service} credentials saved to ${credPath}`);
  }
  
  /**
   * Delete credentials for specific service
   */
  async delete(userContext: UserContext, service: ServiceType): Promise<void> {
    const all = await this.getAll(userContext);
    delete all[service];
    await this.saveAll(userContext, all);
    console.log(`[CredentialsStore] ✅ ${service} credentials deleted`);
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
      console.log('[CredentialsStore] ✅ All credentials deleted');
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
   */
  private loadEncryptionKey(): Buffer {
    // 1. Try environment variable first (highest priority)
    const keyString = process.env.ANT_ENCRYPTION_KEY;
    
    if (keyString) {
      console.log('[CredentialsStore] ✅ Using ANT_ENCRYPTION_KEY from environment');
      return Buffer.from(keyString, 'hex');
    }
    
    // 2. Try file in workspaces/.ant/encryption.key
    const keyFilePath = path.join(this.workspaceRoot, '.ant', 'encryption.key');
    
    try {
      if (fs.existsSync(keyFilePath)) {
        const keyHex = fs.readFileSync(keyFilePath, 'utf8').trim();
        console.log('[CredentialsStore] ✅ Using encryption key from file:', keyFilePath);
        return Buffer.from(keyHex, 'hex');
      }
      
      // 3. Generate new key as fallback
      console.warn('[CredentialsStore] ⚠️  No encryption key found, generating new one...');
      console.warn('[CredentialsStore] ⚠️  Consider setting ANT_ENCRYPTION_KEY in .env file');
      
      const key = crypto.randomBytes(32);
      const keyHex = key.toString('hex');
      fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
      fs.writeFileSync(keyFilePath, keyHex, { mode: 0o600 });
      
      console.log('[CredentialsStore] ✅ Generated new encryption key:', keyFilePath);
      console.log('[CredentialsStore] ℹ️  Copy this to .env: ANT_ENCRYPTION_KEY=' + keyHex);
      
      return key;
    } catch (error) {
      console.error('[CredentialsStore] ❌ Failed to load/save encryption key:', error);
      console.error('[CredentialsStore] ⚠️  Using temporary key (credentials will not persist!)');
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
   * Check if error is decryption error
   */
  private isDecryptionError(error: any): boolean {
    return error.message?.includes('Unsupported state') ||
           error.message?.includes('unable to authenticate data') ||
           error.message?.includes('bad decrypt');
  }
}

