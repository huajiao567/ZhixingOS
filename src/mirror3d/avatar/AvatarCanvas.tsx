import type { FC } from 'react';
import type { AvatarIdentity, AvatarRenderState } from '../types/avatar';

export interface AvatarCanvasProps {
  identity: AvatarIdentity;
  render: AvatarRenderState;
  paused?: boolean;
}

/**
 * tsc 解析用基础声明。
 * 运行时会优先解析同目录下的 AvatarCanvas.native.tsx / AvatarCanvas.web.tsx（Metro 按平台选择），
 * 因此本文件不会被打包进运行时；它仅让 TypeScript 能找到 `./AvatarCanvas` 模块。
 */
export const AvatarCanvas: FC<AvatarCanvasProps> = () => null;
