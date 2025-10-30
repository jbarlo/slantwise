Slantwise is a tool that watches files in your file system and can perform
operations (both semantic and classic string manipulation) to create derivative
documents. All operation results are cached by their inputs to create a form of
determinism. Documents can be thought of like a cell in Excel, but in a
document-centric way. Documents are stored content-first, where the file path
becomes "just metadata" pointing to where some specific document contents are
known to be stored in the file system. This has the nice side-effect of
automatically deduping previously seen files. Outputs and variants of the same
document are cached in an unbounded way, with an expectation the user will
trigger garbage-collection when wanted/needed.

Check the @justfile for common useful commands.
