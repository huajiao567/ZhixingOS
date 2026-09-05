import type { PersonalModelVersion, AvatarVisibility } from '../../types/models';
import type { AvatarProfileV2, AvatarTimelineEntry } from './v2/avatarTypes';

export type AvatarRenderMode = 'text' | 'icon' | 'static3d' | 'dynamic3d';

export function resolveAvatarRenderMode(visibility: AvatarVisibility | null | undefined): AvatarRenderMode {
  switch (visibility) {
    case 'V0': return 'text';
    case 'V1': return 'icon';
    case 'V2': return 'static3d';
    case 'V3': return 'dynamic3d';
    // 服务契约尚未加载时保持完整 V3 能力；不得把网络/初始化空值当作降级信号。
    default: return 'dynamic3d';
  }
}

function changeSummary(version: PersonalModelVersion): string {
  const summary = version.change_log?.change_summary;
  return typeof summary === 'string' && summary.trim() ? summary.trim() : '个人认识有了新的版本';
}

export function syncModelVersionsToAvatarTimeline(
  profile: AvatarProfileV2,
  versions: PersonalModelVersion[],
  capturedAt: string,
): AvatarProfileV2 {
  const knownIds = new Set(
    profile.timeline
      .map((entry) => entry.sourceModelVersionId)
      .filter((id): id is string => typeof id === 'string'),
  );

  const missing = [...versions]
    .filter((version) => !knownIds.has(version.id))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  if (missing.length === 0) return profile;

  const entries: AvatarTimelineEntry[] = missing.map((version, index) => ({
    timelineVersion: profile.timeline.length + index + 1,
    kind: 'stage_confirmed',
    label: version.version,
    identityVersion: profile.identity.identityVersion,
    appearanceVersion: profile.appearance.appearanceVersion,
    sourceModelVersionId: version.id,
    sourceModelVersion: version.version,
    snapshotProvenance: 'captured_on_first_sync',
    snapshot: {
      characterId: profile.appearance.characterId,
      paletteId: profile.appearance.paletteId,
      behavior: { ...profile.behaviorStyle },
    },
    createdAt: version.created_at,
    capturedAt,
    note: `${changeSummary(version)}。形象参数在本设备首次同步该版本时捕获，不反推或重写过去。`,
  }));

  return { ...profile, timeline: [...profile.timeline, ...entries] };
}
