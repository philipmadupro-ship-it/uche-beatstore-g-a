/** Synthetic DAW file heads built from the documented formats, for tests only. */
import zlib from 'node:zlib';

/** FL Studio: FLhd + FLdt with a version text event (199) and a fine tempo event (156). */
export function flpFixture(opts: { version?: string; bpm?: number; legacyBpm?: number } = {}): Uint8Array {
  const events: number[] = [];
  // a few small events first (id < 64: 1 byte; id < 128: 2 bytes), like a real file
  events.push(0x40 - 1, 1); // id 63, 1 byte
  events.push(65, 0x10, 0x00); // id 65, word
  if (opts.version) {
    const text = Buffer.from(`${opts.version}\0`, 'latin1');
    events.push(199, text.length, ...text); // text event: varint length
  }
  if (opts.legacyBpm != null) events.push(66, opts.legacyBpm & 0xff, (opts.legacyBpm >> 8) & 0xff);
  if (opts.bpm != null) {
    const v = Math.round(opts.bpm * 1000);
    events.push(156, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  }
  const hdr = Buffer.from([0x46, 0x4c, 0x68, 0x64, 6, 0, 0, 0, 0, 0, 2, 0, 0x60, 0x00]);
  const dt = Buffer.alloc(8);
  dt.write('FLdt', 0, 'latin1');
  dt.writeUInt32LE(events.length, 4);
  return new Uint8Array(Buffer.concat([hdr, dt, Buffer.from(events)]));
}

export function alsFixture(opts: { creator?: string; bpm?: number } = {}): Uint8Array {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Ableton MajorVersion="5" MinorVersion="11.0_11202" SchemaChangeCount="3" Creator="${opts.creator ?? 'Ableton Live 11.0.12'}" Revision="x">\n` +
    `<LiveSet><Tracks><MidiTrack><Name><EffectiveName Value="Secret Vocal Chain" /></Name></MidiTrack></Tracks>` +
    `<MasterTrack><DeviceChain><Mixer><Tempo><LomId Value="0" /><Manual Value="${opts.bpm ?? 128}" /></Tempo></Mixer></DeviceChain></MasterTrack>` +
    `<SampleRef><FileRef><Path Value="C:\\Users\\me\\Samples\\kick.wav" /></FileRef></SampleRef></LiveSet></Ableton>`;
  return new Uint8Array(zlib.gzipSync(Buffer.from(xml)));
}

export function rppFixture(opts: { version?: string; bpm?: number } = {}): Uint8Array {
  const text =
    `<REAPER_PROJECT 0.1 "${opts.version ?? '6.80'}/linux-x86_64" 1700000000\n  RIPPLE 0\n  TEMPO ${opts.bpm ?? 140} 4 4\n  <TRACK\n    NAME "Secret Track"\n    <ITEM\n      FILE "/home/me/samples/snare.wav"\n    >\n  >\n>\n`;
  return new Uint8Array(Buffer.from(text, 'latin1'));
}

/** A zip's first local file header with the given entry name (enough for `zipFirstEntryName`). */
export function zipFixture(firstEntry: string): Uint8Array {
  const name = Buffer.from(firstEntry, 'latin1');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(name.length, 26);
  return new Uint8Array(Buffer.concat([header, name, Buffer.alloc(16)]));
}
