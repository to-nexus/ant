/**
 * Figma Design Extractor
 * 
 * Extracts design information from Figma files using authenticated user access
 */

import { FigmaPort } from '../../ports/figma';
import { UserConfigManager, FigmaCredentials } from '../../../utils/userConfig';
import { UserContext } from '../../types/user';
import { FigmaFileReader, FigmaFileReference } from './FigmaFileReader';

export interface ExtractedDesign {
  fileKey: string;
  fileName: string;
  components: {
    id: string;
    name: string;
    type: string;
    properties: any;
  }[];
  styles: {
    colors: Record<string, string>;
    typography: Record<string, any>;
    spacing: Record<string, string>;
  };
  assets: {
    id: string;
    name: string;
    url: string;
  }[];
}

export class FigmaDesignExtractor {
  constructor(
    private figmaAdapter: FigmaPort,
    private userConfigManager: UserConfigManager,
    private workspaceRoot: string
  ) {}
  
  /**
   * Extract designs from all Figma references in inputs/figma.md
   */
  async extractDesigns(
    featurePath: string,
    userContext: UserContext
  ): Promise<ExtractedDesign[]> {
    // Check if user has Figma credentials
    const credentials = await this.userConfigManager.credentials.get<FigmaCredentials>(
      userContext,
      'figma'
    );
    
    if (!credentials || !credentials.accessToken) {
      throw new Error('Figma not connected. Please connect your Figma account first.');
    }
    
    // Read Figma references from inputs/figma.md
    const references = FigmaFileReader.readFigmaReferences(featurePath);
    
    if (references.length === 0) {
      console.log('[Figma] No Figma references found in inputs/figma.md');
      return [];
    }
    
    console.log(`[Figma] Found ${references.length} Figma file(s) to extract`);
    
    // Connect to Figma with user's access token
    await this.figmaAdapter.connect(credentials.accessToken, '');
    
    const designs: ExtractedDesign[] = [];
    
    // Extract design from each file
    for (const ref of references) {
      try {
        console.log(`[Figma] Extracting design from: ${ref.url}`);
        
        const file = await this.figmaAdapter.getFile(ref.fileKey);
        const designTokens = await this.figmaAdapter.extractDesignTokens(ref.fileKey);
        
        designs.push({
          fileKey: ref.fileKey,
          fileName: file.name,
          components: [], // TODO: Extract components
          styles: {
            colors: designTokens.colors,
            typography: designTokens.typography,
            spacing: designTokens.spacing
          },
          assets: [] // TODO: Extract assets
        });
        
        console.log(`[Figma] ✅ Extracted design from ${file.name}`);
      } catch (error: any) {
        console.error(`[Figma] ❌ Failed to extract ${ref.url}:`, error.message);
        // Continue with other files
      }
    }
    
    await this.figmaAdapter.disconnect();
    
    return designs;
  }
  
  /**
   * Get preview of designs without full extraction
   */
  async previewDesigns(
    featurePath: string,
    userContext: UserContext
  ): Promise<FigmaFileReference[]> {
    const references = FigmaFileReader.readFigmaReferences(featurePath);
    
    // Check credentials
    const credentials = await this.userConfigManager.credentials.get<FigmaCredentials>(
      userContext,
      'figma'
    );
    
    if (!credentials) {
      throw new Error('Figma not connected');
    }
    
    // TODO: Fetch file thumbnails
    
    return references;
  }
}
