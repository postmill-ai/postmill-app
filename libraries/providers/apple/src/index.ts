export * from './v1';
import { appleAuthModule, applePaymentsModule } from './v1';
const appleProviderModules = [appleAuthModule, applePaymentsModule];
export default appleProviderModules;
