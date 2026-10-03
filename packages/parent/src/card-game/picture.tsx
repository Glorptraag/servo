// A card's picture: the part's art from the swap registry by its record's art key, or, with none there yet, a vector
// placeholder drawn from the record's colours and proportions (ground rule 12), as the spec card draws it. The name is
// not on the picture: the child is asked for it.
import type { ArtRegistry } from '@servo/app/store';
import type { PartRecord } from '@servo/schema';

export const CARD_PX = 200;

export const CardPicture = ({ record, art }: { readonly record: PartRecord; readonly art: ArtRegistry }) => {
  const entry = art.get(record.identity.art);
  if (entry) {
    return <img className="servo-card-picture" src={entry.src} alt="" width={CARD_PX} height={CARD_PX} draggable={false} />;
  }
  const { x, y } = record.body.size;
  const scale = (CARD_PX - 24) / Math.max(x, y, 1);
  const width = Math.max(12, x * scale);
  const height = Math.max(12, y * scale);
  return (
    <svg
      className="servo-card-picture"
      width={CARD_PX}
      height={CARD_PX}
      viewBox={`0 0 ${CARD_PX} ${CARD_PX}`}
      aria-hidden="true"
      focusable="false"
      data-placeholder=""
    >
      <rect
        x={(CARD_PX - width) / 2}
        y={(CARD_PX - height) / 2}
        width={width}
        height={height}
        rx={8}
        fill={record.identity.colours.main}
        stroke={record.identity.colours.accent}
        strokeWidth={6}
      />
    </svg>
  );
};
