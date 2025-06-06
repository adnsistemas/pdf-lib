import { defaultDocumentSnapshot, DocumentSnapshot } from 'src/api/snapshot';
import PDFHeader from 'src/core/document/PDFHeader';
import PDFTrailer from 'src/core/document/PDFTrailer';
import PDFInvalidObject from 'src/core/objects/PDFInvalidObject';
import PDFName from 'src/core/objects/PDFName';
import PDFNumber from 'src/core/objects/PDFNumber';
import PDFObject from 'src/core/objects/PDFObject';
import PDFRef from 'src/core/objects/PDFRef';
import PDFStream from 'src/core/objects/PDFStream';
import PDFContext from 'src/core/PDFContext';
import PDFCrossRefStream from 'src/core/structures/PDFCrossRefStream';
import PDFObjectStream from 'src/core/structures/PDFObjectStream';
import PDFWriter from 'src/core/writers/PDFWriter';
import { last, waitForTick } from 'src/utils';
import PDFDict from 'src/core/objects/PDFDict';
import PDFCatalog from 'src/core/structures/PDFCatalog';
import PDFPageTree from 'src/core/structures/PDFPageTree';
import PDFPageLeaf from 'src/core/structures/PDFPageLeaf';

class PDFStreamWriter extends PDFWriter {
  static forContext = (
    context: PDFContext,
    objectsPerTick: number,
    encodeStreams = true,
    objectsPerStream = 50,
  ) =>
    new PDFStreamWriter(
      context,
      objectsPerTick,
      defaultDocumentSnapshot,
      encodeStreams,
      objectsPerStream,
    );

  static forContextWithSnapshot = (
    context: PDFContext,
    objectsPerTick: number,
    snapshot: DocumentSnapshot,
    encodeStreams = true,
    objectsPerStream = 50,
  ) =>
    new PDFStreamWriter(
      context,
      objectsPerTick,
      snapshot,
      encodeStreams,
      objectsPerStream,
    );

  private readonly encodeStreams: boolean;
  private readonly objectsPerStream: number;

  private constructor(
    context: PDFContext,
    objectsPerTick: number,
    snapshot: DocumentSnapshot,
    encodeStreams: boolean,
    objectsPerStream: number,
  ) {
    super(context, objectsPerTick, snapshot);

    this.encodeStreams = encodeStreams;
    this.objectsPerStream = objectsPerStream;
  }

  protected async computeBufferSize(incremental: boolean) {
    let objectNumber = this.context.largestObjectNumber + 1;

    const header = PDFHeader.forVersion(1, 7);

    let size = this.snapshot.pdfSize;
    if (!incremental) {
      size += header.sizeInBytes() + 1;
    }
    size += 1;

    const xrefStream = PDFCrossRefStream.create(
      this.createTrailerDict(),
      this.encodeStreams,
    );

    const uncompressedObjects: [PDFRef, PDFObject][] = [];
    const compressedObjects: [PDFRef, PDFObject][][] = [];
    const objectStreamRefs: PDFRef[] = [];

    const security = this.context.security;

    const indirectObjects = this.context.enumerateIndirectObjects();
    for (let idx = 0, len = indirectObjects.length; idx < len; idx++) {
      const indirectObject = indirectObjects[idx];
      const [ref, object] = indirectObject;
      if (!this.snapshot.shouldSave(ref.objectNumber)) {
        continue;
      }

      const shouldNotCompress =
        ref === this.context.trailerInfo.Encrypt ||
        object instanceof PDFStream ||
        object instanceof PDFInvalidObject ||
        object instanceof PDFCatalog ||
        object instanceof PDFPageTree ||
        object instanceof PDFPageLeaf ||
        ref.generationNumber !== 0 ||
        (object instanceof PDFDict &&
          (object as PDFDict).lookup(PDFName.of('Type')) === PDFName.of('Sig'));

      if (shouldNotCompress) {
        uncompressedObjects.push(indirectObject);
        if (security) this.encrypt(ref, object, security);
        xrefStream.addUncompressedEntry(ref, size);
        size += this.computeIndirectObjectSize(indirectObject);
        if (this.shouldWaitForTick(1)) await waitForTick();
      } else {
        let chunk = last(compressedObjects);
        let objectStreamRef = last(objectStreamRefs);
        if (!chunk || chunk.length % this.objectsPerStream === 0) {
          chunk = [];
          compressedObjects.push(chunk);
          objectStreamRef = PDFRef.of(objectNumber++);
          objectStreamRefs.push(objectStreamRef);
        }
        xrefStream.addCompressedEntry(ref, objectStreamRef, chunk.length);
        chunk.push(indirectObject);
      }
    }

    for (let idx = 0, len = compressedObjects.length; idx < len; idx++) {
      const chunk = compressedObjects[idx];
      const ref = objectStreamRefs[idx];

      const objectStream = PDFObjectStream.withContextAndObjects(
        this.context,
        chunk,
        this.encodeStreams,
      );

      if (security) this.encrypt(ref, objectStream, security);

      xrefStream.addUncompressedEntry(ref, size);
      size += this.computeIndirectObjectSize([ref, objectStream]);

      uncompressedObjects.push([ref, objectStream]);

      if (this.shouldWaitForTick(chunk.length)) await waitForTick();
    }

    const xrefStreamRef = PDFRef.of(objectNumber++);
    xrefStream.dict.set(PDFName.of('Size'), PDFNumber.of(objectNumber));
    if (this.snapshot.prevStartXRef) {
      xrefStream.dict.set(
        PDFName.of('Prev'),
        PDFNumber.of(this.snapshot.prevStartXRef),
      );
    }
    xrefStream.addUncompressedEntry(xrefStreamRef, size);
    const xrefOffset = size;
    size += this.computeIndirectObjectSize([xrefStreamRef, xrefStream]);

    uncompressedObjects.push([xrefStreamRef, xrefStream]);

    const trailer = PDFTrailer.forLastCrossRefSectionOffset(xrefOffset);
    size += trailer.sizeInBytes();
    size -= this.snapshot.pdfSize;

    return { size, header, indirectObjects: uncompressedObjects, trailer };
  }
}

export default PDFStreamWriter;
