// Run-mode drawing on one part, in its own frame so it rides, turns and shudders with the part: tread marks sliding
// along a wheel, a servo motor's arm, a light's glow, a battery pack's charge, a switch's contacts, and the visual twin
// of every machine sound it makes (brief Section 11: every sound has a visual twin). What a part gets follows its
// primitives and readouts (ground rule 1). Drawn above the part's body, in its layer. See docs/run-animation.md.
import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { RUN_SOUNDS, TICK_RATE } from '@servo/schema';
import type { RunSound, Vec2 } from '@servo/schema';
import type { ScenePart } from '../scene/scene.ts';
import { mmOf } from '../scene/units.ts';
import type { Palette } from '../renderer/style.ts';
import type { RunCast } from './cast.ts';
import { ARM_MM, ARM_WIDTH_MM, GLOW_REACH_MM, PULSE_HZ, TREAD_MARK_MM, TREAD_SPACING_MM } from './look.ts';
import type { RunDisplay } from './state.ts';

const TAU = Math.PI * 2;
const LINE_MM = mmOf(3);
const radians = (degrees: number): number => (degrees * Math.PI) / 180;
const fraction = (value: number): number => value - Math.floor(value);
/** `value` brought into [0, period). */
export const wrap = (value: number, period: number): number => value - Math.floor(value / period) * period;

/** Mixes `colour` towards white by `amount` (0–1). */
export const lighten = (colour: number, amount: number): number => {
  const channel = (shift: number): number => {
    const value = (colour >> shift) & 255;
    return Math.round(value + (255 - value) * amount) << shift;
  };
  return channel(16) | channel(8) | channel(0);
};

/** Where a wheel's tread marks sit along its length (node x, mm), for a tyre turned `travelled` mm. */
export const treadMarks = (length: number, travelled: number): number[] => {
  const marks: number[] = [];
  const start = -length / 2 + wrap(travelled, TREAD_SPACING_MM);
  const inset = TREAD_MARK_MM / 2;
  for (let x = start; x <= length / 2 - inset; x += TREAD_SPACING_MM) if (x >= -length / 2 + inset) marks.push(x);
  return marks;
};

/** The arm's turn in the node's frame (radians, clockwise on screen at rotation 0): at rest it points along +x. */
export const armTurn = (angle: number, restDeg: number): number => -radians(angle - restDeg);

/**
 * Where a part's Run-mode drawing shows now, in the node's frame (mm, y down): what the e2e harness probes in real
 * screenshots. Only what is drawn now is listed.
 */
export interface PartTells {
  /** The middle of each tread mark, along both long edges. */
  readonly treads?: readonly Vec2[];
  /** A point on the arm, three quarters of the way out. */
  readonly arm?: Vec2;
  /** Points in the glow, outside the part's tile. */
  readonly glow?: readonly Vec2[];
  /** A point in the charge gauge's fill, and one in its empty part when at least a tenth has drained. */
  readonly charge?: { readonly full: Vec2; readonly empty?: Vec2 };
  /** Points on each sound twin that shows. */
  readonly sounds?: Readonly<Partial<Record<RunSound, readonly Vec2[]>>>;
}

interface SoundTwin {
  readonly graphics: Graphics;
  readonly second?: Graphics;
}

export class PartOverlay {
  readonly part: ScenePart;
  private readonly container: Container;
  private readonly cast: RunCast;
  /** Tread marks: one shared shape, each mark only moved, so a turning wheel redraws nothing. */
  private readonly tread: Container | undefined;
  private readonly treadShape: GraphicsContext | undefined;
  private readonly treadMarksPool: Graphics[] = [];
  private readonly arm: Graphics | undefined;
  private readonly glow: Graphics | undefined;
  private readonly gauge: Graphics | undefined;
  private readonly lever: Graphics | undefined;
  private readonly twins = new Map<RunSound, SoundTwin>();
  private readonly reach: number;
  private palette: Palette;
  private drawnTread = Number.NaN;
  private drawnCharge = Number.NaN;
  private drawnDraining = false;
  private drawnClosed: boolean | undefined;

  constructor(part: ScenePart, cast: RunCast, container: Container, palette: Palette) {
    this.part = part;
    this.cast = cast;
    this.container = container;
    this.palette = palette;
    const { w, h } = part.tile;
    this.reach = Math.sqrt(w * w + h * h) / 2;
    const add = (label: string): Graphics => {
      const graphics = new Graphics({ label });
      container.addChild(graphics);
      return graphics;
    };
    const light = cast.lights.get(part.id);
    if (light !== undefined) {
      this.glow = add('glow');
      this.drawGlow(light);
    }
    if (cast.wheels.has(part.id)) {
      this.tread = new Container({ label: 'tread' });
      container.addChild(this.tread);
      const depth = this.treadDepth;
      const { h } = part.tile;
      this.treadShape = new GraphicsContext()
        .rect(-TREAD_MARK_MM / 2, -h / 2, TREAD_MARK_MM, depth)
        .rect(-TREAD_MARK_MM / 2, h / 2 - depth, TREAD_MARK_MM, depth)
        .fill({ color: palette.label, alpha: 0.8 });
      const count = Math.ceil(part.tile.w / TREAD_SPACING_MM) + 1;
      for (let i = 0; i < count; i++) {
        const mark = new Graphics(this.treadShape);
        this.treadMarksPool.push(mark);
        this.tread.addChild(mark);
      }
    }
    if (cast.sources.has(part.id)) this.gauge = add('charge');
    if (cast.switches.has(part.id)) this.lever = add('contacts');
    const arm = cast.arms.get(part.id);
    if (arm) {
      this.arm = add('arm');
      this.arm.position.set(arm.pivot.x, -arm.pivot.y);
      this.drawArm();
    }
    for (const sound of RUN_SOUNDS) this.twins.set(sound, this.makeTwin(sound));
    this.hideTwins();
    // Nothing shows until the first frame: Run mode draws the build as it stands until then.
    container.visible = false;
  }

  destroy(): void {
    this.container.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.container.visible = true;
    this.treadShape?.destroy();
  }

  /** Draws the part as the display has it. */
  update(display: RunDisplay): void {
    this.container.visible = true;
    const id = this.part.id;
    if (this.glow) {
      const level = display.lights.get(id) ?? 0;
      this.glow.alpha = level;
      this.glow.visible = level > 0.004;
    }
    if (this.tread) {
      const travelled = display.treads.get(id) ?? 0;
      if (travelled !== this.drawnTread) this.drawTread(travelled);
    }
    if (this.gauge) {
      const charge = display.charges.get(id);
      const draining = display.draining.has(id);
      const changed = Number.isNaN(this.drawnCharge) || Math.abs((charge ?? 0) - this.drawnCharge) >= 0.005 || draining !== this.drawnDraining;
      if (charge !== undefined && changed) this.drawGauge(charge, draining);
    }
    if (this.lever) {
      const closed = display.closed.get(id);
      if (closed !== undefined && closed !== this.drawnClosed) this.drawLever(closed);
    }
    const arm = this.cast.arms.get(id);
    if (this.arm && arm) this.arm.rotation = armTurn(display.arms.get(id) ?? arm.restDeg, arm.restDeg);
    this.updateTwins(display);
  }

  // ---------------------------------------------------------------------------------------------------------

  private drawGlow(colour: number): void {
    const glow = this.glow as Graphics;
    const outer = this.reach + GLOW_REACH_MM;
    const rings = 6;
    for (let i = rings; i >= 1; i--) glow.circle(0, 0, (outer * i) / rings).fill({ color: colour, alpha: 0.14 });
    glow.circle(0, 0, mmOf(7)).fill({ color: lighten(colour, 0.7) });
  }

  private get treadDepth(): number {
    return Math.min(this.part.tile.h * 0.28, mmOf(14));
  }

  private get gaugeBox(): { readonly x: number; readonly y: number; readonly length: number; readonly height: number } {
    const { w, h } = this.part.tile;
    const length = w * 0.7;
    const height = mmOf(7);
    return { x: -length / 2, y: h / 2 - height - mmOf(5), length, height };
  }

  /** Where this part's drawing shows now, in its node's frame (see PartTells). */
  tells(display: RunDisplay): PartTells {
    const id = this.part.id;
    const { w, h } = this.part.tile;
    const around = (radius: number): Vec2[] =>
      Array.from({ length: 8 }, (_, i) => ({ x: Math.cos((TAU * i) / 8) * radius, y: Math.sin((TAU * i) / 8) * radius }));
    const tells: {
      treads?: Vec2[];
      arm?: Vec2;
      glow?: Vec2[];
      charge?: { full: Vec2; empty?: Vec2 };
      sounds?: Partial<Record<RunSound, Vec2[]>>;
    } = {};
    if (this.tread) {
      const depth = this.treadDepth;
      tells.treads = treadMarks(w, display.treads.get(id) ?? 0).flatMap((x) => [
        { x, y: -h / 2 + depth / 2 },
        { x, y: h / 2 - depth / 2 },
      ]);
    }
    const arm = this.cast.arms.get(id);
    if (this.arm && arm) {
      const turn = this.arm.rotation;
      const out = ARM_MM * 0.75;
      tells.arm = { x: this.arm.position.x + Math.cos(turn) * out, y: this.arm.position.y + Math.sin(turn) * out };
    }
    if (this.glow?.visible) tells.glow = around(this.reach + GLOW_REACH_MM * 0.35);
    const charge = display.charges.get(id);
    if (this.gauge && charge !== undefined) {
      const box = this.gaugeBox;
      const y = box.y + box.height / 2;
      tells.charge = {
        full: { x: box.x + (box.length * charge) / 2, y },
        ...(charge <= 0.9 ? { empty: { x: box.x + (box.length * (1 + charge)) / 2, y } } : {}),
      };
    }
    const sounds: Partial<Record<RunSound, Vec2[]>> = {};
    for (const [sound, twin] of this.twins) {
      if (!twin.graphics.visible) continue;
      const shift = twin.graphics.position;
      if (sound === 'buzz') sounds.buzz = around(this.reach * twin.graphics.scale.x);
      if (sound === 'hum') sounds.hum = [-1, 1].map((side) => ({ x: shift.x, y: shift.y + side * (h / 2 + mmOf(6) + mmOf(2.5)) }));
      if (sound === 'motor') sounds.motor = [1, 2, 3].map((step) => ({ x: -w / 2 - mmOf(5) * step - mmOf(2), y: 0 }));
      if (sound === 'squeal' || sound === 'knock') sounds[sound] = around(this.reach + mmOf(5));
    }
    if (Object.keys(sounds).length > 0) tells.sounds = sounds;
    return tells;
  }

  private drawTread(travelled: number): void {
    this.drawnTread = travelled;
    const marks = treadMarks(this.part.tile.w, travelled);
    this.treadMarksPool.forEach((mark, index) => {
      const x = marks[index];
      // Hidden by alpha, not visibility, so the batch keeps its shape and only moves.
      mark.alpha = x === undefined ? 0 : 1;
      if (x !== undefined) mark.position.x = x;
    });
  }

  private drawArm(): void {
    const arm = this.arm as Graphics;
    const { palette } = this;
    arm
      .roundRect(-ARM_WIDTH_MM / 2, -ARM_WIDTH_MM / 2, ARM_MM + ARM_WIDTH_MM / 2, ARM_WIDTH_MM, ARM_WIDTH_MM / 2)
      .fill({ color: palette.socketInner })
      .stroke({ color: palette.label, width: LINE_MM / 1.5 });
    arm.circle(0, 0, ARM_WIDTH_MM * 0.3).fill({ color: palette.label });
  }

  /** The charge left, as a bar. While a fault that shows `drain` is active on the pack, the bar is in the power colour. */
  private drawGauge(charge: number, draining: boolean): void {
    const gauge = this.gauge as Graphics;
    this.drawnCharge = charge;
    this.drawnDraining = draining;
    gauge.clear();
    const { x, y, length, height } = this.gaugeBox;
    gauge.roundRect(x, y, length, height, height / 2).fill({ color: this.palette.tile }).stroke({ color: this.palette.label, width: mmOf(1.5) });
    const fill = draining ? this.palette.types.power.colour : this.palette.label;
    if (charge > 0) gauge.roundRect(x, y, length * charge, height, height / 2).fill({ color: fill });
  }

  private drawLever(closed: boolean): void {
    const lever = this.lever as Graphics;
    this.drawnClosed = closed;
    lever.clear();
    const span = Math.min(this.part.tile.w * 0.22, mmOf(26));
    const contact = mmOf(4.5);
    const { label, socketInner } = this.palette;
    const reach = 2 * span;
    const turn = closed ? 0 : -radians(35);
    const end = { x: -span + reach * Math.cos(turn), y: reach * Math.sin(turn) };
    // A light edge under the dark lever, so it reads over a dark picture as well as a light tile.
    for (const [color, grow] of [[socketInner, mmOf(3)], [label, 0]] as const) {
      lever.circle(-span, 0, contact + grow / 2).circle(span, 0, contact + grow / 2).fill({ color });
      lever.moveTo(-span, 0).lineTo(end.x, end.y).stroke({ color, width: mmOf(5) + grow, cap: 'round' });
    }
    lever.circle(-span, 0, contact * 0.45).fill({ color: socketInner });
  }

  private makeTwin(sound: RunSound): SoundTwin {
    const graphics = new Graphics({ label: `sound ${sound}` });
    this.container.addChild(graphics);
    const r = this.reach;
    const stroke = { color: this.palette.label, width: LINE_MM, cap: 'round' as const };
    const { w, h } = this.part.tile;
    switch (sound) {
      case 'buzz': {
        graphics.circle(0, 0, r).stroke(stroke);
        const second = new Graphics({ label: 'sound buzz 2' });
        second.circle(0, 0, r).stroke(stroke);
        this.container.addChild(second);
        return { graphics, second };
      }
      case 'hum':
        // A tremble beside each long side.
        for (const side of [-1, 1]) {
          for (const step of [1, 2]) {
            const y = side * (h / 2 + mmOf(6) * step);
            graphics.moveTo(-w * 0.25, y).quadraticCurveTo(0, y + side * mmOf(5), w * 0.25, y);
          }
        }
        graphics.stroke(stroke);
        return { graphics };
      case 'motor':
        // A whirr behind it.
        for (const step of [1, 2, 3]) {
          const x = -w / 2 - mmOf(5) * step;
          graphics.moveTo(x, -h * 0.3).quadraticCurveTo(x - mmOf(4), 0, x, h * 0.3);
        }
        graphics.stroke(stroke);
        return { graphics };
      case 'squeal':
        for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
          const x = sx * (w / 2 + mmOf(3));
          const y = sy * (h / 2 + mmOf(3));
          graphics.moveTo(x, y).lineTo(x + sx * mmOf(8), y + sy * mmOf(8));
        }
        graphics.stroke(stroke);
        return { graphics };
      case 'knock':
        for (let i = 0; i < 8; i++) {
          const angle = (TAU * i) / 8;
          graphics.moveTo(Math.cos(angle) * r, Math.sin(angle) * r).lineTo(Math.cos(angle) * (r + mmOf(10)), Math.sin(angle) * (r + mmOf(10)));
        }
        graphics.stroke(stroke);
        return { graphics };
    }
  }

  private hideTwins(): void {
    for (const twin of this.twins.values()) {
      twin.graphics.visible = false;
      if (twin.second) twin.second.visible = false;
    }
  }

  private updateTwins(display: RunDisplay): void {
    const playing = display.sounds.get(this.part.id);
    const seconds = display.ticks / TICK_RATE;
    for (const [sound, twin] of this.twins) {
      const level = playing?.get(sound) ?? 0;
      const on = level > 0;
      twin.graphics.visible = on;
      if (twin.second) twin.second.visible = on;
      if (!on) continue;
      const phase = seconds * PULSE_HZ[sound];
      switch (sound) {
        case 'buzz': {
          // Rings leaving the part, one after the other: a pulse each beat.
          const rings = [twin.graphics, twin.second as Graphics];
          rings.forEach((ring, index) => {
            const f = fraction(phase + index / 2);
            ring.scale.set(1 + 0.45 * f);
            ring.alpha = level * (1 - f);
          });
          break;
        }
        case 'hum':
          twin.graphics.alpha = 0.85 * level;
          twin.graphics.position.set(0, mmOf(1.2) * Math.sin(TAU * phase));
          break;
        case 'motor':
          twin.graphics.alpha = Math.min(1, level) * (0.35 + 0.2 * Math.sin(TAU * phase));
          break;
        case 'squeal':
          twin.graphics.alpha = level * (0.6 + 0.4 * Math.abs(Math.sin(TAU * phase)));
          break;
        case 'knock':
          twin.graphics.alpha = level;
          break;
      }
    }
  }
}
