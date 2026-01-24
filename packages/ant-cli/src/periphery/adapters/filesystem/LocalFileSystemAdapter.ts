/**
 * LocalFileSystemAdapter (DEPRECATED)
 * 
 * @deprecated Use FileSystemAdapter from './FileSystemAdapter' instead.
 * This file is kept for backward compatibility only.
 * 
 * FileSystemAdapter works with any POSIX-compatible filesystem:
 * - Local filesystem
 * - NFS mounts
 * - AWS EFS mounts
 */

export { FileSystemAdapter, FileSystemAdapter as LocalFileSystemAdapter } from './FileSystemAdapter';
