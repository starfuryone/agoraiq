import type { SignalFields, ValidationResult } from './types';
export declare class SignalValidator {
    /**
     * Validates a full or partial signal.
     * Accepts `Partial<SignalFields>` so the UI can call this live as the user
     * fills in fields, without needing every field to be present.
     */
    validate(signal: Partial<SignalFields>): ValidationResult;
}
//# sourceMappingURL=validator.d.ts.map