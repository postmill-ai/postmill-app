export * from './v1';
import { telegramSocialModule, telegramCommsModule } from './v1';
const telegramProviderModules = [telegramSocialModule, telegramCommsModule];
export default telegramProviderModules;
