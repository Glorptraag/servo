// The part's picture beside its real name (brief Section 10: at Levels 1–2 real names are always paired with a
// picture). It comes from the swap registry by the record's art key; with no picture there yet, a vector placeholder
// is drawn from the record's colours and proportions (ground rule 12). The name beside it says what it is, so the
// picture is decorative to a screen reader.
import type { ArtRegistry } from '@servo/content';
import type { AssetKey, PartRecord } from '@servo/schema';

export const PICTURE_PX = 56;

export const PartPicture = ({ record, art }: { readonly record: PartRecord; readonly art: ArtRegistry }) => {
  const entry = art.get(record.identity.art);
  if (entry) {
    return <img className="spec-card-picture" src={entry.src} alt="" width={PICTURE_PX} height={PICTURE_PX} draggable={false} />;
  }
  const { x, y } = record.body.size;
  const scale = (PICTURE_PX - 8) / Math.max(x, y, 1);
  const width = Math.max(6, x * scale);
  const height = Math.max(6, y * scale);
  return (
    <svg className="spec-card-picture" width={PICTURE_PX} height={PICTURE_PX} viewBox={`0 0 ${PICTURE_PX} ${PICTURE_PX}`} aria-hidden="true" focusable="false" data-placeholder="">
      <rect
        x={(PICTURE_PX - width) / 2}
        y={(PICTURE_PX - height) / 2}
        width={width}
        height={height}
        rx={4}
        fill={record.identity.colours.main}
        stroke={record.identity.colours.accent}
        strokeWidth={3}
      />
    </svg>
  );
};

/** The real-world picture beside the popular-mechanics line, where the registry has one. */
export const RealWorldPicture = ({ assetKey, art }: { readonly assetKey: AssetKey | undefined; readonly art: ArtRegistry }) => {
  const entry = assetKey === undefined ? undefined : art.get(assetKey);
  return entry ? <img className="spec-card-real-world" src={entry.src} alt="" width={PICTURE_PX} height={PICTURE_PX} draggable={false} /> : null;
};
