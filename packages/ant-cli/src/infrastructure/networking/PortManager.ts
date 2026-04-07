/**
 * PortManager
 * 
 * Manages dynamic port allocation for preview servers and IDEs.
 * Port ranges are separated by service type:
 * - Preview: 30000-39999 (10,000 ports)
 * - IDE: 40000-49999 (10,000 ports)
 */

import * as net from 'net';

export type PortType = 'dev-server' | 'ide' | 'deploy';

export interface PortRangeConfig {
  min: number;
  max: number;
}

export const PORT_RANGES: Record<PortType, PortRangeConfig> = {
  'dev-server': { min: 30000, max: 39999 },  // 10,000 ports
  'ide': { min: 40000, max: 49999 },          // 10,000 ports
  'deploy': { min: 50000, max: 54999 },       // 5,000 ports
};

export class PortManager {
  // Defaults
  private readonly MIN_PORT = PORT_RANGES['dev-server'].min;  // 30000
  private readonly MAX_PORT = PORT_RANGES['deploy'].max;      // 54999
  private usedPorts = new Set<number>();
  
  /**
   * Allocate an available port for a specific service type
   * @param type - 'dev-server' or 'ide' (defaults to 'dev-server')
   */
  async allocate(type: PortType = 'dev-server'): Promise<number> {
    const range = PORT_RANGES[type];
    for (let port = range.min; port <= range.max; port++) {
      if (!this.usedPorts.has(port) && await this.isPortAvailable(port)) {
        this.usedPorts.add(port);
        console.log(`[PortManager] Allocated ${type} port: ${port}`);
        return port;
      }
    }
    throw new Error(`No available ports in ${type} range ${range.min}-${range.max}`);
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
   * Get current usage stats (overall or by type)
   */
  getStats(type?: PortType): { total: number; used: number; available: number } {
    if (type) {
      const range = PORT_RANGES[type];
      const total = range.max - range.min + 1;
      const used = Array.from(this.usedPorts).filter(
        p => p >= range.min && p <= range.max
      ).length;
      return { total, used, available: total - used };
    }
    
    // Overall stats
    const total = this.MAX_PORT - this.MIN_PORT + 1;
    const used = this.usedPorts.size;
    return {
      total,
      used,
      available: total - used
    };
  }

  /**
   * Get stats for all port types
   */
  getStatsByType(): Record<PortType, { total: number; used: number; available: number }> {
    return {
      'dev-server': this.getStats('dev-server'),
      'ide': this.getStats('ide'),
      'deploy': this.getStats('deploy'),
    };
  }
}

