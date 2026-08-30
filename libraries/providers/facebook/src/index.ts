export * from './v1';
import { facebookSocialModule, facebookAuthModule } from './v1';
const facebookProviderModules = [facebookSocialModule, facebookAuthModule];
export default facebookProviderModules;
