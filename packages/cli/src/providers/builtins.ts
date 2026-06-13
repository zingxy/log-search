import { sshProvider } from '@log-search/provider-ssh';
import { slsProvider } from '@log-search/provider-sls';
import { dockerProvider } from '@log-search/provider-docker';
import type { Provider } from '@log-search/provider-types';

export function registerBuiltins(register: (provider: Provider) => void): void {
  register(sshProvider);
  register(slsProvider);
  register(dockerProvider);
}
