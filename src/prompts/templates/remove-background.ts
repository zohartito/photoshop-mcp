import {
  argBool,
  argInt,
  userPrompt,
  type PhotoshopPromptTemplate,
} from '../_shared.js';

export const removeBackgroundTemplate: PhotoshopPromptTemplate = {
  name: 'ps.remove_background',
  description:
    'Remove the background from the active layer using Select Subject, with an optional feather radius and an option to keep a soft contact shadow. Users often say: remove background, cut out, isolate subject, transparent background, arka planı sil.',
  arguments: [
    {
      name: 'feather_px',
      description:
        'Edge feather in pixels (0-20). 0 = hard edge (default for product shots), 1-3 = soft edge for portraits.',
      required: false,
    },
    {
      name: 'keep_shadow',
      description:
        'When true, duplicate the layer first, blur and darken it to simulate a contact shadow. Default false.',
      required: false,
    },
  ],
  handler: (args) => {
    const feather = Math.max(0, Math.min(20, argInt(args, 'feather_px', 0)));
    const keepShadow = argBool(args, 'keep_shadow', false);

    const text = [
      `Goal: Remove the background from the subject on the active layer using Select Subject.`,
      ``,
      `Plan:`,
      `1. Call \`photoshop_get_state\` to confirm an active document with a non-background active layer that contains a subject.`,
      `2. Call \`photoshop_get_capabilities\` only if you have not yet this session; verify \`select_subject_v2\` is available.`,
      `3. Call \`photoshop_recipe_remove_background\` with { feather_px: ${feather}, keep_shadow: ${keepShadow} }.`,
      `   - The recipe internally runs Select Subject, inverts the selection, adds a layer mask, applies the feather, and (if keep_shadow) creates a shadow layer underneath.`,
      `4. Call \`photoshop_get_preview\` to show the result against transparency.`,
      `5. If the mask edge needs refinement, ask the user before adding a refine-edge pass — that step is destructive on the mask.`,
      ``,
      `End state: the subject layer carries a vector/pixel mask hiding the background; on-canvas background pixels are untouched (mask, not erase). One undo reverts the whole recipe.`,
    ].join('\n');

    return userPrompt(`Remove the background (feather ${feather}px, shadow=${keepShadow}).`, text);
  },
};
