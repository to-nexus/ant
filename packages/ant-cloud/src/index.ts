/**
 * @ant/cloud server entry. The OSS `cloudPlugin.loadCloudModule()` reads the
 * default export (`mod.default ?? mod`) and treats it as the `CloudModule`.
 */
export { default } from './cloudModule.impl';
