/**
 * Bounds for operations that make Photoshop allocate pixel buffers.  These are
 * deliberately checked in tool handlers as well as advertised in schemas: MCP
 * schemas describe inputs but are not a runtime enforcement boundary.
 */
export const MAX_DOCUMENT_DIMENSION_PX = 16_384;
export const MAX_DOCUMENT_PIXELS = 100_000_000;
export const MAX_PREVIEW_DIMENSION_PX = 4_096;
export const MAX_DOCUMENT_RESOLUTION_DPI = 2_400;

export function validateIntegerInRange(
  value: unknown,
  min: number,
  max: number,
  name: string
): string | null {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    return `${name} must be an integer from ${min} to ${max}.`;
  }
  return null;
}

export function validatePixelDimensions(width: unknown, height: unknown): string | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    (width as number) < 1 ||
    (height as number) < 1
  ) {
    return 'width and height must be positive integer pixel values.';
  }
  if (
    (width as number) > MAX_DOCUMENT_DIMENSION_PX ||
    (height as number) > MAX_DOCUMENT_DIMENSION_PX
  ) {
    return `width and height must not exceed ${MAX_DOCUMENT_DIMENSION_PX}px.`;
  }
  if ((width as number) * (height as number) > MAX_DOCUMENT_PIXELS) {
    return `Document dimensions must not exceed ${MAX_DOCUMENT_PIXELS.toLocaleString()} total pixels.`;
  }
  return null;
}
