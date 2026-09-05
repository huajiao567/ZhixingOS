import React from 'react';
import Svg, { Circle, Path, Rect, Line } from 'react-native-svg';

/** 知行镜自定义字形（无表情符号，统一 SVG） */
export function Glyph({ name, size = 22, color = '#A9B3C0' }: {
  name: 'today' | 'mirror' | 'progress' | 'secretary' | 'data' | 'check' | 'warn' | 'flask' | 'clock' | 'arrow' | 'shield' | 'voice' | 'photo' | 'pen' | 'silence' | 'book' | 'layers' | 'heart' | 'body' | 'compass' | 'pin';
  size?: number; color?: string;
}) {
  const p = { width: size, height: size, viewBox: '0 0 24 24' };
  const stroke = { stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  switch (name) {
    case 'today': // 日晷/今日
      return <Svg {...p}><Circle cx="12" cy="12" r="4.2" {...stroke} /><Path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5 5l1.7 1.7M17.3 17.3L19 19M19 5l-1.7 1.7M6.7 17.3L5 19" {...stroke} /></Svg>;
    case 'mirror': // 镜像
      return <Svg {...p}><Rect x="5" y="3" width="14" height="18" rx="3" {...stroke} /><Path d="M9 14.5c1.2-2.6 4.8-2.6 6 0M9.5 9h.01M14.5 9h.01" {...stroke} /></Svg>;
    case 'progress': // 进程/生长
      return <Svg {...p}><Path d="M4 20V10M10 20V4M16 20v-8M22 20H2" {...stroke} /><Path d="M15.5 6.5L19 3l1 3.6" {...stroke} /></Svg>;
    case 'secretary': // 参谋/对话
      return <Svg {...p}><Path d="M21 12a8 8 0 0 1-8 8c-1.4 0-2.8-.3-4-1l-5 1.4L5.4 16A8 8 0 1 1 21 12Z" {...stroke} /><Path d="M8.5 11h5M8.5 14h3" {...stroke} /></Svg>;
    case 'data': // 数据主权/钥匙
      return <Svg {...p}><Rect x="4" y="10" width="16" height="10" rx="2.5" {...stroke} /><Path d="M8 10V7.5a4 4 0 0 1 8 0V10" {...stroke} /><Circle cx="12" cy="15" r="1.6" fill={color} /></Svg>;
    case 'check':
      return <Svg {...p}><Circle cx="12" cy="12" r="9" {...stroke} /><Path d="M8.5 12.2l2.4 2.4 4.6-5" {...stroke} /></Svg>;
    case 'warn':
      return <Svg {...p}><Path d="M12 3.5L22 20H2L12 3.5Z" {...stroke} /><Path d="M12 10v4.2M12 17.2h.01" {...stroke} /></Svg>;
    case 'flask': // 实验
      return <Svg {...p}><Path d="M9.5 3h5M10.5 3v5.2L5 17.5A2.4 2.4 0 0 0 7.2 21h9.6a2.4 2.4 0 0 0 2.2-3.5l-5.5-9.3V3" {...stroke} /><Path d="M7.5 14.5h9" {...stroke} /></Svg>;
    case 'clock':
      return <Svg {...p}><Circle cx="12" cy="12" r="9" {...stroke} /><Path d="M12 7v5.2l3.4 2" {...stroke} /></Svg>;
    case 'arrow':
      return <Svg {...p}><Path d="M5 12h14M13 6l6 6-6 6" {...stroke} /></Svg>;
    case 'shield':
      return <Svg {...p}><Path d="M12 3l7.5 3v5.5c0 4.6-3.1 8-7.5 9.5-4.4-1.5-7.5-4.9-7.5-9.5V6L12 3Z" {...stroke} /><Path d="M9 12l2.2 2.2L15.5 10" {...stroke} /></Svg>;
    case 'voice':
      return <Svg {...p}><Rect x="9" y="3" width="6" height="11" rx="3" {...stroke} /><Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" {...stroke} /></Svg>;
    case 'photo':
      return <Svg {...p}><Rect x="3" y="5" width="18" height="15" rx="2.5" {...stroke} /><Circle cx="9" cy="10.5" r="1.6" {...stroke} /><Path d="M4 18l5-4.5 3.5 3 4-3.5L20 16" {...stroke} /></Svg>;
    case 'pen':
      return <Svg {...p}><Path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5 4 20Z" {...stroke} /></Svg>;
    case 'silence':
      return <Svg {...p}><Path d="M8 9.5a4 4 0 1 1 7.4 2.1c-.6 1.5-1.4 2.4-1.4 4.4h-4c0-2-.8-2.9-1.4-4.4" {...stroke} /><Path d="M4 4l16 16" {...stroke} /></Svg>;
    case 'book':
      return <Svg {...p}><Path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17.5H7.5A2.5 2.5 0 0 0 5 22V4.5Z" {...stroke} /><Path d="M5 19.5A2.5 2.5 0 0 1 7.5 17H20" {...stroke} /></Svg>;
    case 'layers':
      return <Svg {...p}><Path d="M12 3l9 5-9 5-9-5 9-5Z" {...stroke} /><Path d="M3 13l9 5 9-5" {...stroke} /></Svg>;
    case 'heart': // 情绪/心形
      return <Svg {...p}><Path d="M12 20.5S3.5 14.5 3.5 9A4.5 4.5 0 0 1 12 6.5a4.5 4.5 0 0 1 8.5 2.5c0 5.5-8.5 11.5-8.5 11.5Z" {...stroke} /></Svg>;
    case 'body': // 健康/身体
      return <Svg {...p}><Circle cx="12" cy="5.5" r="3" {...stroke} /><Path d="M12 8.5v7M7.5 10.5l-2 9M16.5 10.5l2 9M8.5 15.5h7" {...stroke} /></Svg>;
    case 'compass': // 规划/方向
      return <Svg {...p}><Circle cx="12" cy="12" r="9" {...stroke} /><Path d="M15.5 8.5l-2.5 5-5 2.5 2.5-5 5-2.5Z" {...stroke} /><Circle cx="12" cy="12" r="1" fill={color} /></Svg>;
    case 'pin': // 提醒/固定
      return <Svg {...p}><Path d="M12 2C8.5 2 5.5 4.8 5.5 8.5c0 4.5 6.5 13.5 6.5 13.5s6.5-9 6.5-13.5C18.5 4.8 15.5 2 12 2Z" {...stroke} /><Circle cx="12" cy="8.5" r="2.5" {...stroke} /></Svg>;
    default:
      return null;
  }
}

/** 主题切换字形（与现有 Glyph 同风格：1.7px 描边、viewBox 24×24、圆角端点） */

const glyphDefaults = { size: 22, color: '#A9B3C0' } as const;
const commonStroke = (color: string) => ({
  stroke: color,
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
});

export function Moon({ size = glyphDefaults.size, color = glyphDefaults.color }: { size?: number; color?: string }) {
  const stroke = commonStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M20 13.5A8 8 0 1 1 10.5 3a6.5 6.5 0 0 0 9.5 10.5Z" {...stroke} />
    </Svg>
  );
}

export function Sun({ size = glyphDefaults.size, color = glyphDefaults.color }: { size?: number; color?: string }) {
  const stroke = commonStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="4" {...stroke} />
      <Path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" {...stroke} />
    </Svg>
  );
}

export function Desktop({ size = glyphDefaults.size, color = glyphDefaults.color }: { size?: number; color?: string }) {
  const stroke = commonStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="3" y="4" width="18" height="13" rx="2" {...stroke} />
      <Path d="M9 21h6M12 17v4" {...stroke} />
    </Svg>
  );
}
