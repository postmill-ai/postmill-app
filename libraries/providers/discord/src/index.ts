export * from './v1';
import { discordSocialModule, discordCommsModule } from './v1';
const discordProviderModules = [discordSocialModule, discordCommsModule];
export default discordProviderModules;
