import type { PromptRegistry } from '../core/prompt-registry.js';
import { toPromptDefinition } from './_shared.js';
import { enhancePortraitTemplate } from './templates/enhance-portrait.js';
import { removeBackgroundTemplate } from './templates/remove-background.js';
import { prepareForWebTemplate } from './templates/prepare-for-web.js';
import { exportSocialVariantsTemplate } from './templates/export-social-variants.js';
import { applyColorGradeTemplate } from './templates/apply-color-grade.js';
import { frequencySeparationTemplate } from './templates/frequency-separation.js';
import { batchMockupReplaceTemplate } from './templates/batch-mockup-replace.js';
import { organizeLayersTemplate } from './templates/organize-layers.js';

export const PHOTOSHOP_PROMPT_TEMPLATES = [
  enhancePortraitTemplate,
  removeBackgroundTemplate,
  prepareForWebTemplate,
  exportSocialVariantsTemplate,
  applyColorGradeTemplate,
  frequencySeparationTemplate,
  batchMockupReplaceTemplate,
  organizeLayersTemplate,
] as const;

export function registerPhotoshopPrompts(registry: PromptRegistry): void {
  for (const template of PHOTOSHOP_PROMPT_TEMPLATES) {
    registry.register(template.name, toPromptDefinition(template));
  }
}
