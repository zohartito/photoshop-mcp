import {
  argInt,
  userPrompt,
  type PhotoshopPromptTemplate,
} from '../_shared.js';

export const removeDistractionTemplate: PhotoshopPromptTemplate = {
  name: 'ps.remove_distraction',
  description:
    'One-shot distraction removal via content-aware fill on the current selection. Users often say: remove that person, erase distraction, content aware remove, clone out object. Generative remove is not scriptable — content-aware only.',
  arguments: [
    {
      name: 'feather_px',
      description: 'Edge feather in pixels before fill (0-20). Default 0.',
      required: false,
    },
  ],
  handler: (args) => {
    const feather = Math.max(0, Math.min(20, argInt(args, 'feather_px', 0)));

    const text = [
      `Goal: Remove the selected distraction or object via content-aware fill in one undoable step.`,
      ``,
      `Plan:`,
      `1. Call \`photoshop_get_state\` to confirm an active document and check whether a pixel selection exists.`,
      `2. If no selection: call \`photoshop_select_rectangle\`, \`photoshop_select_subject\`, or ask the user to define the region to remove.`,
      `3. Call \`photoshop_recipe_remove_distraction\` with { feather_px: ${feather} }.`,
      `   - The recipe feathers the selection (if ${feather} > 0), runs content-aware fill, and deselects.`,
      `4. If the result returns \`selection_required\`, go back to step 2.`,
      `5. Call \`photoshop_get_preview\` once. If artifacts remain, ask the user to refine manually — generative remove is not available via ExtendScript.`,
      `6. For generative-remove requests, explain the limitation and offer content-aware fill or manual clone/heal.`,
      ``,
      `End state: selected pixels are inpainted; selection cleared; one undo reverts the fill.`,
    ].join('\n');

    return userPrompt(`Remove distraction (feather ${feather}px).`, text);
  },
};
