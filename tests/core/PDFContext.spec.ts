import pako from 'pako';

import {
  PDFArray,
  PDFBool,
  PDFContentStream,
  PDFContext,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFString,
} from '../../src/core';
import { mergeIntoTypedArray } from '../../src/utils';

describe('PDFContext', () => {
  it('retains assigned objects', () => {
    const context = PDFContext.create();

    const pdfBool = PDFBool.True;
    const pdfHexString = PDFHexString.of('ABC123');
    const pdfName = PDFName.of('Foo#Bar!');
    const pdfNull = PDFNull;
    const pdfNumber = PDFNumber.of(-24.179);
    const pdfString = PDFString.of('foobar');
    const pdfDict = context.obj({ Foo: PDFName.of('Bar') });
    const pdfArray = context.obj([PDFBool.True, pdfDict]);

    context.assign(PDFRef.of(0), pdfBool);
    context.assign(PDFRef.of(1), pdfHexString);
    context.assign(PDFRef.of(2), pdfName);
    context.assign(PDFRef.of(3), pdfNull);
    context.assign(PDFRef.of(4), pdfNumber);
    context.assign(PDFRef.of(5), pdfString);
    context.assign(PDFRef.of(6), pdfDict);
    context.assign(PDFRef.of(7), pdfArray);

    expect(context.lookup(PDFRef.of(0))).toBe(pdfBool);
    expect(context.lookup(PDFRef.of(1))).toBe(pdfHexString);
    expect(context.lookup(PDFRef.of(2))).toBe(pdfName);
    expect(context.lookup(PDFRef.of(3))).toBe(pdfNull);
    expect(context.lookup(PDFRef.of(4))).toBe(pdfNumber);
    expect(context.lookup(PDFRef.of(5))).toBe(pdfString);
    expect(context.lookup(PDFRef.of(6))).toBe(pdfDict);
    expect(context.lookup(PDFRef.of(7))).toBe(pdfArray);
  });

  it('does not use object number 0 during registration', () => {
    const context = PDFContext.create();
    expect(context.register(PDFBool.True)).toBe(PDFRef.of(1));
  });

  it('returns the given object during lookup if it is not a PDFRef', () => {
    const context = PDFContext.create();
    const pdfNumber = PDFNumber.of(21);
    expect(context.lookup(pdfNumber)).toBe(pdfNumber);
  });

  it('assigns the next highest object number during registration', () => {
    const context = PDFContext.create();

    const pdfBool = PDFBool.True;
    const pdfName = PDFName.of('FooBar');
    const pdfNumber = PDFNumber.of(-21.436);

    const boolRef = context.register(pdfBool);
    expect(boolRef).toBe(PDFRef.of(1));
    expect(context.lookup(boolRef)).toBe(pdfBool);

    context.assign(PDFRef.of(9000), pdfName);

    const numberRef = context.register(pdfNumber);
    expect(numberRef).toBe(PDFRef.of(9001));
    expect(context.lookup(numberRef)).toBe(pdfNumber);
  });

  it('stream creation', () => {
    const context = PDFContext.create();

    const stream = context.flateStream('stuff and things!');
    const buffer = new Uint8Array(stream.sizeInBytes());
    stream.copyBytesInto(buffer, 0);

    expect(buffer).toEqual(
      mergeIntoTypedArray(
        '<<\n',
        '/Filter /FlateDecode\n',
        '/Length 25\n',
        '>>\n',
        'stream\n',
        pako.deflate('stuff and things!'),
        '\nendstream',
      ),
    );
  });

  describe('literal conversions', () => {
    const context = PDFContext.create();

    it('converts null literals to the PDFNull instance', () => {
      const literal = null;
      const obj = context.obj(literal);
      expect(obj).toBe(PDFNull);
      expect(context.getLiteral(obj)).toBe(literal);
    });

    it('converts string literals to PDFName instances', () => {
      const literal = 'foobar';
      const obj = context.obj(literal);
      expect(obj).toBeInstanceOf(PDFName);
      expect(obj.toString()).toBe(`/${literal}`);
      expect(context.getLiteral(obj)).toBe(literal);
    });

    it('converts number literals to PDFNumber instances', () => {
      const literal = -21.4e-3;
      const obj = context.obj(literal);
      expect(obj).toBeInstanceOf(PDFNumber);
      expect(obj.toString()).toBe('-0.0214');
      expect(context.getLiteral(obj)).toBe(literal);
    });

    it('converts boolean literals to PDFBool instances', () => {
      expect(context.obj(true)).toBe(PDFBool.True);
      expect(context.getLiteral(PDFBool.True)).toBe(true);
      expect(context.obj(false)).toBe(PDFBool.False);
      expect(context.getLiteral(PDFBool.False)).toBe(false);
    });

    it('converts array literals to PDFArray instances', () => {
      const array = [
        PDFRef.of(21),
        true,
        PDFHexString.of('ABC123'),
        'Foo#Bar!',
        [null, -24.179],
        { Foo: PDFName.of('Bar') },
      ];
      const obj = context.obj(array);
      expect(obj).toBeInstanceOf(PDFArray);
      expect(obj.toString()).toEqual(
        '[ 21 0 R true <ABC123> /Foo#23Bar! [ null -24.179 ] <<\n/Foo /Bar\n>> ]',
      );
      (array[5] as any).Foo = 'Bar';
      expect(context.getLiteral(obj)).toEqual(array);
    });

    it('converts object literals to PDFDict instances', () => {
      const dict = {
        Ref: PDFRef.of(21),
        Boolean: true,
        HexString: PDFHexString.of('ABC123'),
        Null: null,
        Number: -24.179,
        Name: 'Foo#Bar!',
        Dictionary: { Array: [true, null] },
      };
      const obj = context.obj(dict);
      expect(obj).toBeInstanceOf(PDFDict);
      expect(obj.toString()).toEqual(
        `<<
/Ref 21 0 R
/Boolean true
/HexString <ABC123>
/Null null
/Number -24.179
/Name /Foo#23Bar!
/Dictionary <<
/Array [ true null ]
>>
>>`,
      );
      expect(context.getLiteral(obj)).toEqual(dict);
    });

    it('converts PDFObject instances to their literal representation', () => {
      const dict = {
        Ref: PDFRef.of(21),
        Boolean: true,
        String: PDFString.of('blub'),
        HexString: PDFHexString.of('ABC123'),
        Null: null,
        Number: -3.5e-2,
        Name: 'Foo#Bar()',
        Dictionary: { Array: [true, null] },
      };
      const obj = context.obj(dict);

      // Default conversion
      let lit = context.getLiteral(obj);
      expect(lit).toEqual(dict);

      // Shallow conversion
      lit = context.getLiteral(obj, { deep: false });
      expect(lit.Boolean).toBe(PDFBool.True);
      expect(lit.Null).toBe(PDFNull);
      expect(lit.Number).toBeInstanceOf(PDFNumber);
      expect(lit.Name).toBeInstanceOf(PDFName);
      expect(lit.Dictionary).toBeInstanceOf(PDFDict);

      // Extended conversion
      lit = context.getLiteral(obj, { literalRef: true, literalString: true });
      expect(lit.Ref).toBe(21);
      expect(lit.String).toBe('blub');
      expect(lit.HexString).toBe('ABC123');
      const stream = context.stream('foo', dict);
      lit = context.getLiteral(stream, {
        literalStreamDict: true,
      }) as typeof dict;
      expect(lit).toEqual(dict);
      stream.updateDict();
      lit = context.getLiteral(stream, { literalStreamDict: true }) as {
        Length: number;
      };
      expect(lit.Length).toBe(3);
    });
  });

  it('can provide a reference to a "pushGraphicsState" content stream', () => {
    const context = PDFContext.create();
    expect(context.enumerateIndirectObjects().length).toBe(0);

    const ref1 = context.getPushGraphicsStateContentStream();
    expect(ref1).toBeInstanceOf(PDFRef);
    expect(context.enumerateIndirectObjects().length).toBe(1);

    const ref2 = context.getPushGraphicsStateContentStream();
    expect(ref2).toBeInstanceOf(PDFRef);
    expect(context.enumerateIndirectObjects().length).toBe(1);

    expect(ref1).toBe(ref2);
    expect(context.lookup(ref1)).toBeInstanceOf(PDFContentStream);
  });

  it('can provide a reference to a "popGraphicsState" content stream', () => {
    const context = PDFContext.create();
    expect(context.enumerateIndirectObjects().length).toBe(0);

    const ref1 = context.getPopGraphicsStateContentStream();
    expect(ref1).toBeInstanceOf(PDFRef);
    expect(context.enumerateIndirectObjects().length).toBe(1);

    const ref2 = context.getPopGraphicsStateContentStream();
    expect(ref2).toBeInstanceOf(PDFRef);
    expect(context.enumerateIndirectObjects().length).toBe(1);

    expect(ref1).toBe(ref2);
    expect(context.lookup(ref1)).toBeInstanceOf(PDFContentStream);
  });
});
