import type {
  DesignerOutput,
  VideoOutput,
} from './designer-doc.schema';
import { genId } from './designer-doc.migrate';
import { cloneElementsForDuplication } from './designer-doc.pages';

export const duplicateImageOutput = (
  source: DesignerOutput,
  name: string,
  linkContent: boolean,
  contentLinkGroup: string,
  idGen: () => string = genId
): { output: DesignerOutput; sourceOutput: DesignerOutput } | null => {
  if (
    linkContent &&
    source.frozen &&
    source.children.some((element) => !element.originId)
  ) {
    return null;
  }
  const sourceChildren = source.children.map((element) =>
    linkContent && !element.originId ? { ...element, originId: idGen() } : element
  );
  const output = JSON.parse(JSON.stringify(source)) as DesignerOutput;
  output.id = idGen();
  output.name = name;
  output.contentLinkGroup = contentLinkGroup;
  delete output.frozen;
  output.children = cloneElementsForDuplication(
    sourceChildren,
    linkContent ? 'preserve' : 'remove',
    idGen
  );
  output.pages = source.pages?.map((page) => ({
    ...JSON.parse(JSON.stringify(page)),
    id: idGen(),
    children: cloneElementsForDuplication(
      page.children,
      linkContent ? 'fresh' : 'remove',
      idGen
    ),
  }));
  return {
    output,
    sourceOutput: { ...source, children: sourceChildren },
  };
};

export const duplicateVideoOutput = (
  source: VideoOutput,
  name: string,
  linkContent: boolean,
  idGen: () => string = genId
): { output: VideoOutput; sourceOutput: VideoOutput } | null => {
  if (
    linkContent &&
    source.frozen &&
    source.tracks.some((track) => track.clips.some((clip) => !clip.originId))
  ) {
    return null;
  }
  const sourceTracks = source.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) =>
      linkContent && !clip.originId
        ? { ...clip, originId: `origin-${idGen()}` }
        : clip
    ),
  }));
  const groups = new Map<string, string>();
  const output = JSON.parse(JSON.stringify(source)) as VideoOutput;
  output.id = idGen();
  output.name = name;
  delete output.frozen;
  output.tracks = sourceTracks.map((track) => ({
    ...JSON.parse(JSON.stringify(track)),
    id: idGen(),
    clips: track.clips.map((clip) => {
      if (clip.groupId && !groups.has(clip.groupId)) groups.set(clip.groupId, idGen());
      return {
        ...JSON.parse(JSON.stringify(clip)),
        id: idGen(),
        originId: linkContent ? clip.originId : undefined,
        groupId: clip.groupId ? groups.get(clip.groupId) : undefined,
      };
    }),
  }));
  output.markers = source.markers?.map((marker) => ({
    ...marker,
    id: idGen(),
  }));
  return {
    output,
    sourceOutput: { ...source, tracks: sourceTracks },
  };
};
