import { describe, it, expect } from 'vitest';
import { parseTitleMetadata, describeTitleMetadata } from './title-metadata';

const parse = parseTitleMetadata;

describe('parseTitleMetadata — how producers actually name files', () => {
  it.each([
    ['Night Shift 140 Fm.wav', 'Night Shift', 140, 'F', 'minor'],
    ['drill_type_beat_142bpm_Gmin.mp3', 'drill type beat', 142, 'G', 'minor'],
    ['COLD FRONT (Bb maj) 92 BPM.wav', 'COLD FRONT', 92, 'Bb', 'major'],
    ['midnight - 128 - C#m.aiff', 'midnight', 128, 'C#', 'minor'],
    ['Sunset @ 95 in A flat minor.mp3', 'Sunset in', 95, 'Ab', 'minor'],
    ['BPM 75 Trap Soul F# minor.wav', 'Trap Soul', 75, 'F#', 'minor'],
    ['no metadata here.wav', 'no metadata here', null, null, null],
  ])('%s', (file, title, bpm, key, scale) => {
    const out = parse(file);
    expect(out.title).toBe(title);
    expect(out.bpm).toBe(bpm);
    expect(out.key).toBe(key);
    expect(out.scale).toBe(scale);
  });
});

describe('BPM', () => {
  it('accepts a marked tempo outside the bare range', () => {
    expect(parse('halftime 45bpm.wav').bpm).toBe(45);
    expect(parse('footwork 240 BPM.wav').bpm).toBe(240);
  });

  it('ignores a bare number outside a plausible tempo range', () => {
    expect(parse('beat 45.wav').bpm).toBeNull();
    expect(parse('beat 240.wav').bpm).toBeNull();
  });

  it('never reads a year as a tempo', () => {
    const out = parse('Type Beat 2026.wav');
    expect(out.bpm).toBeNull();
    expect(out.title).toBe('Type Beat 2026');
  });

  it('ignores numbers glued to other characters', () => {
    expect(parse('808 mafia v2 hard.wav').bpm).toBeNull();
    expect(parse('beat_v2.wav').bpm).toBeNull();
  });

  it('prefers the marked tempo when a bare number is also present', () => {
    expect(parse('Take 2 - 140bpm.wav').bpm).toBe(140);
  });

  it('reads 808 as a tempo only when marked', () => {
    expect(parse('808 heavy.wav').bpm).toBeNull();
    expect(parse('808 heavy 808bpm.wav').bpm).toBeNull();
  });
});

describe('key', () => {
  it('reads accidentals in every spelling', () => {
    expect(parse('beat F#m.wav')).toMatchObject({ key: 'F#', scale: 'minor' });
    expect(parse('beat Bbmaj.wav')).toMatchObject({ key: 'Bb', scale: 'major' });
    expect(parse('beat C sharp minor.wav')).toMatchObject({ key: 'C#', scale: 'minor' });
    expect(parse('beat E flat major.wav')).toMatchObject({ key: 'Eb', scale: 'major' });
  });

  it('takes a plain note only with an explicit quality', () => {
    expect(parse('beat Gmin.wav').key).toBe('G');
    expect(parse('beat in D major.wav')).toMatchObject({ key: 'D', scale: 'major' });
    expect(parse('beat G.wav').key).toBeNull();
  });

  it('reads an explicit key marker', () => {
    expect(parse('beat key of C.wav')).toMatchObject({ key: 'C', scale: null });
  });

  it('leaves sample-style note names alone', () => {
    expect(parse('kick C4.wav').key).toBeNull();
    expect(parse('sub A1 long.wav').key).toBeNull();
  });

  it('does not invent a key from ordinary words', () => {
    for (const name of ['Cold Front.wav', 'be mine.wav', 'a night alone.wav', 'FM radio.wav']) {
      expect(parse(name).key).toBeNull();
    }
  });
});

describe('title cleanup', () => {
  it('removes emptied brackets and stray separators', () => {
    expect(parse('midnight (140 BPM) [F#m].wav').title).toBe('midnight');
    expect(parse('midnight - 140 - .wav').title).toBe('midnight');
  });

  it('never returns an empty title', () => {
    expect(parse('140 Fm.wav').title).toBe('140 Fm');
    expect(parse('.wav').title).toBe('Untagged Track');
  });

  it('keeps a title that carries no metadata untouched apart from separators', () => {
    expect(parse('Deep_Cuts_Vol_3.wav').title).toBe('Deep Cuts Vol 3');
  });
});

describe('describeTitleMetadata', () => {
  it('says what was read, and nothing when nothing was', () => {
    expect(describeTitleMetadata(parse('Night Shift 140 Fm.wav'))).toBe('140 BPM · F minor from the filename');
    expect(describeTitleMetadata(parse('beat Gmin.wav'))).toBe('G minor from the filename');
    expect(describeTitleMetadata(parse('plain.wav'))).toBeNull();
  });
});

describe('the Fm shorthand is case-sensitive on purpose', () => {
  it('reads an uppercase note with a lowercase m', () => {
    expect(parse('beat Gm.wav')).toMatchObject({ key: 'G', scale: 'minor' });
  });

  it.each(['FM radio.wav', 'fm static.wav', 'gm crate.wav'])('leaves %s alone', (name) => {
    expect(parse(name).key).toBeNull();
  });

  it('does not read a chord name as the key', () => {
    expect(parse('Dm7 loop.wav').key).toBeNull();
  });
});

describe('collaborators', () => {
  const names = (filename: string) =>
    parseTitleMetadata(filename).collaborators.map((c) => `${c.role}:${c.name}`);

  it('reads a bracketed producer credit and strips it from the title', () => {
    const meta = parseTitleMetadata('Night Shift (prod. by Metro Boomin).wav');
    expect(meta.collaborators).toEqual([{ name: 'Metro Boomin', role: 'producer' }]);
    expect(meta.title).toBe('Night Shift');
    expect(meta.matched).toContain('collaborators');
  });

  it('accepts the common spellings of a production credit', () => {
    expect(names('A (prod. by X).wav')).toEqual(['producer:X']);
    expect(names('A (prod by X).wav')).toEqual(['producer:X']);
    expect(names('A (prod. X).wav')).toEqual(['producer:X']);
    expect(names('A (produced by X).wav')).toEqual(['producer:X']);
    expect(names('A [PROD. BY X].wav')).toEqual(['producer:X']);
  });

  it('accepts the common spellings of a feature credit', () => {
    expect(names('A (feat. X).wav')).toEqual(['feature:X']);
    expect(names('A (ft. X).wav')).toEqual(['feature:X']);
    expect(names('A (ft X).wav')).toEqual(['feature:X']);
    expect(names('A (featuring X).wav')).toEqual(['feature:X']);
  });

  it('reads w/ and with as a plain collaboration', () => {
    expect(names('Cold Front w/ Jules.wav')).toEqual(['collaborator:Jules']);
    expect(names('Cold Front with Jules.wav')).toEqual(['collaborator:Jules']);
  });

  it('splits several names inside one credit', () => {
    expect(names('A (prod. by X & Y).wav')).toEqual(['producer:X', 'producer:Y']);
    expect(names('A (feat. X, Y and Z).wav')).toEqual(['feature:X', 'feature:Y', 'feature:Z']);
    expect(names('A (prod. by X x Y).wav')).toEqual(['producer:X', 'producer:Y']);
  });

  it('reads more than one credit group, keeping each name its own role', () => {
    const meta = parseTitleMetadata('Night Shift (feat. Ayo) [prod. by Metro].wav');
    expect(meta.collaborators).toEqual([
      { name: 'Ayo', role: 'feature' },
      { name: 'Metro', role: 'producer' },
    ]);
    expect(meta.title).toBe('Night Shift');
  });

  it('reads credits with no brackets at all', () => {
    const meta = parseTitleMetadata('Night Shift prod. by Metro feat. Ayo.wav');
    expect(meta.collaborators).toEqual([
      { name: 'Metro', role: 'producer' },
      { name: 'Ayo', role: 'feature' },
    ]);
    expect(meta.title).toBe('Night Shift');
  });

  it('does NOT read the type-beat x convention as a collaboration', () => {
    // `Cardo x Metro type beat` names who it should SOUND like. Crediting
    // them would put strangers on the producer's own catalogue.
    const meta = parseTitleMetadata('Cardo x Metro Boomin type beat 140 Fm.wav');
    expect(meta.collaborators).toEqual([]);
    expect(meta.title).toBe('Cardo x Metro Boomin type beat');
    expect(meta.bpm).toBe(140);
    expect(meta.key).toBe('F');
  });

  it('keeps a name from being misread as musical metadata', () => {
    // Without credits being taken out first, `Gm` here is a key and `140` a tempo.
    const meta = parseTitleMetadata('Drift (prod. by Gm) 92.wav');
    expect(meta.collaborators).toEqual([{ name: 'Gm', role: 'producer' }]);
    expect(meta.key).toBe(null);
    expect(meta.bpm).toBe(92);
  });

  it('coexists with BPM and key in any order', () => {
    const meta = parseTitleMetadata('COLD FRONT (Bb maj) 92 BPM (feat. Ayo).wav');
    expect(meta.bpm).toBe(92);
    expect(meta.key).toBe('Bb');
    expect(meta.scale).toBe('major');
    expect(meta.collaborators).toEqual([{ name: 'Ayo', role: 'feature' }]);
    expect(meta.title).toBe('COLD FRONT');
  });

  it('de-duplicates a name credited twice in the same role', () => {
    expect(names('A (prod. by X) (prod by X).wav')).toEqual(['producer:X']);
  });

  it('keeps the same person under two different roles', () => {
    // Being both the producer and a feature is a real credit, not a duplicate.
    expect(names('A (prod. by X) (feat. X).wav')).toEqual(['producer:X', 'feature:X']);
  });

  it('is empty when nothing is credited', () => {
    const meta = parseTitleMetadata('Night Shift 140 Fm.wav');
    expect(meta.collaborators).toEqual([]);
    expect(meta.matched).not.toContain('collaborators');
  });

  it('ignores a marker with no name after it', () => {
    expect(names('Night Shift (prod.).wav')).toEqual([]);
    expect(names('Night Shift feat..wav')).toEqual([]);
  });

  it('refuses a name long enough to be a sentence', () => {
    expect(names(`A (feat. ${'n'.repeat(80)}).wav`)).toEqual([]);
  });

  it('never leaves the title empty', () => {
    // The whole name was one credit; falling back beats naming a track "".
    expect(parseTitleMetadata('(prod. by Metro).wav').title).not.toBe('');
  });

  it('describes what it found, credits included', () => {
    const meta = parseTitleMetadata('Night Shift 140 Fm (feat. Ayo).wav');
    expect(describeTitleMetadata(meta)).toBe('140 BPM · F minor · with Ayo from the filename');
  });
});
