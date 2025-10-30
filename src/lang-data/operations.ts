export const operations = [
  {
    name: 'llm',
    detail: 'Apply LLM transformation',
    info: 'llm(input, prompt="...", model="gpt-4o")\n\nApplies a large language model to transform the input using the specified prompt.',
    snippet: 'llm(${1:input}, prompt="${2:your prompt}", model="${3:gpt-4o}")${4}',
    snippetAfterPipe: 'llm(prompt="${1:your prompt}", model="${2:gpt-4o}")${3}'
  },
  {
    name: 'identity',
    detail: 'Identity operation',
    info: 'identity(input)\n\nReturns the input unchanged. Useful for testing and composition.',
    snippet: 'identity(${1:input})${2}',
    snippetAfterPipe: 'identity()'
  },
  {
    name: 'concat',
    detail: 'Concatenate inputs',
    info: 'concat(input1, input2, ...)\n\nConcatenates multiple inputs together.',
    snippet: 'concat(${1:input1}, ${2:input2})${3}',
    snippetAfterPipe: 'concat(${1:input2})${2}'
  },
  {
    name: 'testConstant',
    detail: 'Test constant operation',
    info: 'testConstant()\n\nReturns a constant value for testing purposes.',
    snippet: 'testConstant()',
    snippetAfterPipe: 'testConstant()'
  },
  {
    name: 'getUrlContent',
    detail: 'Fetch URL content',
    info: 'getUrlContent(url)\n\nFetches the content from the specified URL.',
    snippet: 'getUrlContent(${1:url})${2}',
    snippetAfterPipe: 'getUrlContent()'
  }
] as const;

export type OperationName = (typeof operations)[number]['name'];
