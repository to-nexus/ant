import { DesignGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';

const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

/**
 * Handle read_reference_image tool
 * 
 * Returns image data in a format suitable for multimodal LLM input.
 * The result will be added to conversation history as an image content block.
 */
export async function handleReadReferenceImage(
  state: DesignGraphState,
  args: { path: string }
): Promise<{ type: 'image'; path: string; base64: string; mediaType: string } | string> {
  const { path: imagePath } = args;
  const fileSystem = state.deps?.fileSystem;
  const chatAPI = getChatAPIClient();
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  const path = await import('path');
  const fs = await import('fs/promises');
  
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  
  let absolutePath = imagePath;
  if (!path.isAbsolute(imagePath)) {
    absolutePath = path.join(featurePath, imagePath);
  }
  
  const ext = path.extname(absolutePath).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported image format: ${ext}. Supported: ${SUPPORTED_IMAGE_EXTENSIONS.join(', ')}`);
  }
  
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, absolutePath)
    : absolutePath.replace(/^\//, '');
  
  const exists = await fileSystem.fileExists(relativePath);
  if (!exists) {
    throw new Error(`Reference image not found: ${imagePath}`);
  }
  
  // Anthropic API limit: 5MB per image (base64)
  // Base64 encoding adds ~33% overhead, so raw file should be < 3.75MB
  const MAX_IMAGE_BYTES = parseInt(process.env.ANT_UI_IMAGE_MAX_BYTES || `${3 * 1024 * 1024}`, 10);
  
  const stats = await fs.stat(absolutePath);
  if (stats.size > MAX_IMAGE_BYTES) {
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    const limitMB = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
    console.log(`   ⚠️  Image too large: ${imagePath} (${sizeMB}MB > ${limitMB}MB limit)`);
    console.log(`   💡 Consider resizing or compressing the image`);
    
    return `⚠️ Image "${imagePath}" is too large (${sizeMB}MB). Anthropic API limit is 5MB per image (base64 encoded). ` +
           `Original file: ${sizeMB}MB → base64: ~${(stats.size * 1.33 / (1024 * 1024)).toFixed(2)}MB. ` +
           `Please resize or compress the image to under ${limitMB}MB and try again. ` +
           `Proceeding without this image - use available information from PRD/directive.`;
  }
  
  const mergeIndex = await chatAPI.addReadingFile(imagePath);
  
  try {
    const imageBuffer = await fs.readFile(absolutePath);
    const base64 = imageBuffer.toString('base64');
    
    const mediaTypeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };
    const mediaType = mediaTypeMap[ext] || 'image/png';
    
    console.log(`   🖼️  Read image: ${imagePath} (${Math.round(stats.size / 1024)}KB, ${mediaType})`);
    
    await chatAPI.addReadComplete(imagePath, mergeIndex);
    
    return {
      type: 'image',
      path: imagePath,
      base64,
      mediaType,
    };
  } catch (error) {
    await chatAPI.addReadComplete(imagePath, mergeIndex, (error as Error).message);
    throw error;
  }
}

/**
 * Handle list_reference_images tool
 * 
 * Lists all available reference images in inputs/references/
 */
export async function handleListReferenceImages(
  state: DesignGraphState,
  args: { category?: string }
): Promise<string> {
  const { category } = args;
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  
  const referencesDir = path.join(featurePath, 'inputs', 'references');
  const targetDir = category 
    ? path.join(referencesDir, category)
    : referencesDir;
  
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, targetDir)
    : targetDir.replace(/^\//, '');
  
  let allFiles: string[] = [];
  try {
    allFiles = await fileSystem.listFiles(relativePath, []);
  } catch {
    // Directory doesn't exist or not accessible
  }
  
  if (allFiles.length === 0) {
    return JSON.stringify({
      category: category || 'all',
      images: [],
      count: 0,
      message: 'No reference images found. Add images to inputs/references/',
    }, null, 2);
  }
  
  const imageFiles = allFiles.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
  });
  
  const featureRelPath = rootPath
    ? path.relative(rootPath, featurePath)
    : featurePath.replace(/^\//, '');
  
  const referencesRelPath = rootPath
    ? path.relative(rootPath, referencesDir)
    : referencesDir.replace(/^\//, '');
  
  const grouped: Record<string, string[]> = {};
  
  for (const file of imageFiles) {
    const featureRelativePath = file.startsWith(featureRelPath)
      ? file.slice(featureRelPath.length).replace(/^[\/\\]/, '')
      : file;
    
    const refRelative = file.startsWith(referencesRelPath)
      ? file.slice(referencesRelPath.length).replace(/^[\/\\]/, '')
      : featureRelativePath;
    const parts = refRelative.split(/[\/\\]/);
    const group = parts.length > 1 ? parts[0] : '(root)';
    (grouped[group] ||= []).push(featureRelativePath);
  }
  
  const groupSummary = Object.entries(grouped).map(([k, v]) => `${k}: ${v.length}`).join(', ');
  console.log(`   🖼️  Found ${imageFiles.length} reference images (${groupSummary})`);
  if (imageFiles.length > 0) {
    console.log(`   📂 First few: ${imageFiles.slice(0, 3).map(f => path.basename(f)).join(', ')}`);
  }
  
  if (imageFiles.length > 0) {
    const chatAPI = getChatAPIClient();
    const mergeIndex = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
    await chatAPI.showChatStatus('grepped', { 
      filesCount: imageFiles.length,
      filesList: imageFiles,
      _mergeIndex: mergeIndex
    });
  }
  
  return JSON.stringify({
    category: category || 'all',
    groups: grouped,
    total: imageFiles.length,
  }, null, 2);
}
