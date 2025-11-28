import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { UserContext } from '../core/types/user';

interface CredentialData {
  pat: string;
  updatedAt: string;
}

/**
 * Secure credential storage for GitHub PAT
 * - User-level storage (one PAT per user, shared across projects)
 * - AES-256-GCM encryption
 * - File permissions: 0o600 (owner read/write only)
 */
export class CredentialStore {
  private readonly workspaceRoot: string;
  private readonly encryptionKey: Buffer;
  
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    
    // ✅ Load encryption key from environment or generate persistent key
    const keyString = process.env.ANT_ENCRYPTION_KEY;
    
    console.log(`[CredentialStore] Constructor called`);
    console.log(`[CredentialStore] ANT_ENCRYPTION_KEY present: ${!!keyString}`);
    if (keyString) {
      console.log(`[CredentialStore] Using encryption key from environment (length: ${keyString.length})`);
      this.encryptionKey = Buffer.from(keyString, 'hex');
    } else {
      // ✅ Use persistent key file instead of random key
      const keyFilePath = path.join(this.workspaceRoot, '.ant', 'encryption.key');
      
      try {
        if (fs.existsSync(keyFilePath)) {
          const keyHex = fs.readFileSync(keyFilePath, 'utf8').trim();
          this.encryptionKey = Buffer.from(keyHex, 'hex');
          console.log(`[CredentialStore] Using persistent key from ${keyFilePath}`);
        } else {
          // Generate new key and save it
          this.encryptionKey = crypto.randomBytes(32);
          const keyHex = this.encryptionKey.toString('hex');
          fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
          fs.writeFileSync(keyFilePath, keyHex, { mode: 0o600 });
          console.warn(`[CredentialStore] Generated new persistent key: ${keyFilePath}`);
        }
      } catch (error) {
        console.error('[CredentialStore] Failed to load/save persistent key, using temporary key:', error);
        this.encryptionKey = crypto.randomBytes(32);
      }
    }
  }
  
  /**
   * Save PAT for user (encrypted)
   */
  async savePAT(userContext: UserContext, pat: string): Promise<void> {
    const credentialPath = this.getCredentialPath(userContext);
    
    console.log(`[CredentialStore] Saving PAT for org="${userContext.organizationId}", user="${userContext.userId}"`);
    console.log(`[CredentialStore] Save path: ${credentialPath}`);
    
    const encrypted = this.encrypt(pat);
    
    const data: CredentialData = {
      pat: encrypted,
      updatedAt: new Date().toISOString()
    };
    
    // Create directory if not exists
    await fs.promises.mkdir(path.dirname(credentialPath), { recursive: true });
    
    // Write with restricted permissions
    await fs.promises.writeFile(
      credentialPath,
      JSON.stringify(data, null, 2),
      { mode: 0o600 }  // Owner read/write only
    );
    
    console.log(`[CredentialStore] ✅ PAT saved successfully`);
  }
  
  /**
   * Get PAT for user (decrypted)
   */
  async getPAT(userContext: UserContext): Promise<string | null> {
    const credentialPath = this.getCredentialPath(userContext);
    
    console.log(`[CredentialStore] Getting PAT for org="${userContext.organizationId}", user="${userContext.userId}"`);
    console.log(`[CredentialStore] Read path: ${credentialPath}`);
    
    if (!fs.existsSync(credentialPath)) {
      console.log(`[CredentialStore] ❌ PAT file not found`);
      return null;
    }
    
    try {
      const content = await fs.promises.readFile(credentialPath, 'utf-8');
      const data: CredentialData = JSON.parse(content);
      const decrypted = this.decrypt(data.pat);
      console.log(`[CredentialStore] ✅ PAT found and decrypted (length: ${decrypted?.length || 0})`);
      return decrypted;
    } catch (error: any) {
      // Check if it's a decryption error (wrong encryption key)
      if (error.message?.includes('Unsupported state') || 
          error.message?.includes('unable to authenticate data') ||
          error.message?.includes('bad decrypt')) {
        console.error('[CredentialStore] ❌ PAT file corrupted or encrypted with different key');
        console.log('[CredentialStore] 🔧 Auto-deleting corrupted PAT file...');
        
        try {
          await fs.promises.unlink(credentialPath);
          console.log('[CredentialStore] ✅ Corrupted PAT file deleted');
          console.log('[CredentialStore] ℹ️  Please re-enter your PAT in the Configuration screen');
        } catch (unlinkError) {
          console.error('[CredentialStore] Failed to delete corrupted file:', unlinkError);
        }
        
        return null;
      }
      
      console.error('[CredentialStore] Error reading PAT:', error);
      return null;
    }
  }
  
  /**
   * Validate PAT with GitHub API
   */
  async validatePAT(pat: string): Promise<{ valid: boolean; username?: string; error?: string }> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'ANT-CLI'
        }
      });
      
      if (response.ok) {
        const userData = await response.json();
        return { valid: true, username: userData.login };
      } else if (response.status === 401) {
        return { valid: false, error: 'Invalid or expired PAT' };
      } else {
        return { valid: false, error: `GitHub API error: ${response.status}` };
      }
    } catch (error: any) {
      return { valid: false, error: `Network error: ${error?.message || 'Unknown error'}` };
    }
  }
  
  /**
   * Delete PAT for user
   */
  async deletePAT(userContext: UserContext): Promise<void> {
    const credentialPath = this.getCredentialPath(userContext);
    
    if (fs.existsSync(credentialPath)) {
      await fs.promises.unlink(credentialPath);
      console.log(`✅ PAT deleted for user: ${userContext.organizationId}/${userContext.userId}`);
    }
  }
  
  /**
   * Check if PAT exists for user
   */
  async hasPAT(userContext: UserContext): Promise<boolean> {
    const credentialPath = this.getCredentialPath(userContext);
    return fs.existsSync(credentialPath);
  }
  
  /**
   * Get credential file path for user
   * Pattern: {workspaceRoot}/{organizationId}/{userId}/.github-credentials
   */
  private getCredentialPath(userContext: UserContext): string {
    return path.join(
      this.workspaceRoot,
      userContext.organizationId,
      userContext.userId,
      '.github-credentials'
    );
  }
  
  /**
   * Encrypt text using AES-256-GCM
   */
  private encrypt(text: string): string {
    const algorithm = 'aes-256-gcm';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, this.encryptionKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }
  
  /**
   * Decrypt text using AES-256-GCM
   */
  private decrypt(encrypted: string): string {
    const algorithm = 'aes-256-gcm';
    const parts = encrypted.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    
    const decipher = crypto.createDecipheriv(algorithm, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

