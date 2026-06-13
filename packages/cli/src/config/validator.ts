import type { LoadedConfig, ProviderEntry, ProfileEntry } from './loader.js';

export interface ValidationError {
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function validateConfig(
  config: LoadedConfig,
  availableProviderTypes: Set<string>
): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate providers.
  const providerNames = new Set<string>();
  for (const provider of config.providers) {
    if (providerNames.has(provider.name)) {
      errors.push({ message: `Duplicate provider name: "${provider.name}"` });
    }
    providerNames.add(provider.name);

    if (!availableProviderTypes.has(provider.type)) {
      errors.push({
        message: `Provider type "${provider.type}" not found for provider "${provider.name}". Available: ${[...availableProviderTypes].join(', ')}`,
      });
    }
  }

  // Validate profiles.
  const profileNames = new Set<string>();
  for (const profile of config.profiles) {
    if (profileNames.has(profile.name)) {
      errors.push({ message: `Duplicate profile name: "${profile.name}"` });
    }
    profileNames.add(profile.name);

    if (profile.providers.length === 0) {
      errors.push({ message: `Profile "${profile.name}" has no providers` });
    }

    for (const providerName of profile.providers) {
      if (!providerNames.has(providerName)) {
        errors.push({
          message: `Profile "${profile.name}" references unknown provider "${providerName}"`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((e) => `  - ${e.message}`).join('\n');
}
