export type FormFactor = 'mobile' | 'desktop';

export interface FormFactorInput {
  width: number;
  platform: string;
}

/**
 * ZhixingOS uses one product model across devices but deliberately different
 * interaction surfaces. Wide Web becomes the desktop workbench; native apps and
 * narrow Web stay on the mobile companion surface.
 */
export function classifyFormFactor({ width, platform }: FormFactorInput): FormFactor {
  if (platform === 'web' && Number.isFinite(width) && width >= 1100) return 'desktop';
  return 'mobile';
}

export function isDesktopSurface(input: FormFactorInput): boolean {
  return classifyFormFactor(input) === 'desktop';
}
