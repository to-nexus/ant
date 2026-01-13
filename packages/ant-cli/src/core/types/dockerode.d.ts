/**
 * Dockerode type declarations
 * 
 * Minimal type definitions for dockerode module.
 * dockerode doesn't provide official TypeScript types.
 */

declare module 'dockerode' {
  class Docker {
    constructor(options?: any);
    
    listContainers(options?: any): Promise<any[]>;
    getContainer(id: string): any;
    createContainer(options: any): Promise<any>;
    pull(image: string, callback: (err: any, stream: any) => void): void;
    
    modem: {
      followProgress(stream: any, callback: (err: any, output?: any) => void): void;
    };
  }
  
  export = Docker;
}
