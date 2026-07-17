export * from './v1';
import { wrapcastSocialModule, wrapcastAuthModule } from './v1';
const wrapcastProviderModules = [wrapcastSocialModule, wrapcastAuthModule];
export default wrapcastProviderModules;