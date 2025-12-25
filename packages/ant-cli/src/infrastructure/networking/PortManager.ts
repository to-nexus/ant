/**
 * PortManager
 * 
 * Manages dynamic port allocation for dev servers.
 * Uses high port range (30000-35000) to avoid conflicts.
 */

import * as net from 'net';

export class PortManager {
  private readonly MIN_PORT = 30000;
  private readonly MAX_PORT = 35000;
  private usedPorts = new Set<number>();
  
  /**
   * Allocate an available port
   */
  async allocate(): Promise<number> {
    for (let port = this.MIN_PORT; port <= this.MAX_PORT; port++) {
      if (!this.usedPorts.has(port) && await this.isPortAvailable(port)) {
        this.usedPorts.add(port);
        console.log(`[PortManager] Allocated port: ${port}`);
        return port;
      }
    }
    throw new Error('No available ports in range 30000-35000');
  }
  
  /**
   * Release a port
   */
  release(port: number): void {
    this.usedPorts.delete(port);
    console.log(`[PortManager] Released port: ${port}`);
  }
  
  /**
   * Check if port is available
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', () => {
        resolve(false);
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port);
    });
  }
  
  /**
   * Get current usage stats
   */
  getStats(): { total: number; used: number; available: number } {
    const total = this.MAX_PORT - this.MIN_PORT + 1;
    const used = this.usedPorts.size;
    return {
      total,
      used,
      available: total - used
    };
  }
}

