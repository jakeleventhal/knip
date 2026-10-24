type FileExtension = string;

export type CompilerSync = (source: string, path: string) => string;
export type CompilerResult = string | PromiseLike<string>;
export interface CompilerContext {
  readFile: (path: string) => string | undefined;
}
export type Compiler = (source: string, path: string, context: CompilerContext) => CompilerResult;

export type RawCompilers = Map<FileExtension, Compiler | true>;
export type Compilers = Map<FileExtension, Compiler>;

export type HasDependency = (pkgName: string) => boolean;
