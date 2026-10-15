import zlib from "zlib";

const END_OF_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

// enough of the format for archiver's output: no zip64, stored or deflated
export function unzip(buffer: Buffer): Map<string, Buffer> {
    const end = buffer.lastIndexOf(END_OF_DIRECTORY);
    if (end < 0) throw new Error("Not a zip file");
    const count = buffer.readUInt16LE(end + 10);
    let offset = buffer.readUInt32LE(end + 16);
    const files = new Map<string, Buffer>();
    for (let i = 0; i < count; i++) {
        const method = buffer.readUInt16LE(offset + 10);
        const size = buffer.readUInt32LE(offset + 20);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const local = buffer.readUInt32LE(offset + 42);
        const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
        const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
        const data = buffer.subarray(start, start + size);
        files.set(name, method === 0 ? data : zlib.inflateRawSync(data));
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return files;
}
