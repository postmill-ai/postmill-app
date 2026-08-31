export * from './v1';
import { slackSocialModule, slackCommsModule } from './v1';
const slackProviderModules = [slackSocialModule, slackCommsModule];
export default slackProviderModules;
