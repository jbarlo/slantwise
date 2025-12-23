# ↗️ Slantwise

A CLI and local app to iterate on LLM chains with declarative and reactive formulas. Test your prompt variants quickly and as-needed with a deduplicated cache and lazy evaluation.

> Note: this is super alpha software and the database schema is pretty unstable. Early feedback is welcome but please be aware that there is no guarantee data is transferrable from one version to another.

### Why?

Prototyping LLM workflows is too slow!
I developed this project partially out of curiosity and partially because I got impatient prototyping LLM wrappers for simple ideas.
A new LLM-friendly problem stares me in the face every other week; CLI agents are great, but sometimes I just want to lock in a flow that I like.
I found myself wanting the live iteration experience of reactive notebooks with the light syntax ergonomics of https://llm.datasette.io/, while letting me figure out how the pieces fit together as I went.
Essentially, I wanted Excel but with more space to read.
It's still early, but if you want to prototype workflows with formulas, this is for you!

## Usage

Slantwise's fundamental building-block is the "formula", an expression that defines an output.

Every formula is composed of one or more operations.
The core set are outlined here:

- `llm`
- `getUrlContent`
- `concat`

Run `slantwise operations` to see all currently available operations.

`llm` behaves like a single conversation turn:

```
llm("hot air balloon", prompt="write me a bedtime story about the topic", model="openai/gpt-5")
```

Formulas are nestable:

```
llm(
  llm("hot air balloon", prompt="write me a bedtime story about the topic", model="openai/gpt-5"),
  prompt="rate this bedtime story. 5 star scale",
  model="openai/gpt-5"
)
```

or chained using pipe operators (this is the same as the above):

```
llm("hot air balloon", prompt="write me a bedtime story about the topic", model="openai/gpt-5")
|> llm(prompt="write a review for this story",  model="openai/gpt-5")
```

and chains can get arbitrarily long:

```
llm("hot air balloon", prompt="write me a bedtime story about the topic", model="openai/gpt-5")
|> llm(prompt="write a review for this story", model="openai/gpt-5")
|> llm(prompt="give an appropriate 5-point rating that matches this review", model="openai/gpt-o3")
```

`getUrlContent` uses [Jina Reader](https://jina.ai/reader/) to retrieve web content for the given URL in an LLM-friendly format. It's chainable with `llm` for some interesting results:

```
getUrlContent("https://news.ycombinator.com/")
|> llm(prompt="list the links to hardware-related threads", model="openai/gpt-5")
```

Formulas can reference each other using a $-prefixed ID:

```bash
$ slantwise create 'getUrlContent("https://news.ycombinator.com/")'
# => chatty-ghosts-leave

$ slantwise create '$chatty-ghosts-leave |> llm(prompt="list the links to hardware-related threads", model="openai/gpt-5")'
# => thirty-laws-clap
```

Formulas are _lazily evaluated_, meaning they are only computed when read.
This includes when any downstream formulas are read!

Formula results are also cached; when a formula is read (`slantwise read <formula-id>`) for the first time, the results are remembered for future reads.
This means that all operations are treated as if they are deterministic which can be useful when iterating with LLM outputs.

```bash
# Reading the previous example's formula
$ slantwise read thirty-laws-clap
# => - https://news.ycombinator.com/item?id=123...

# Second try is the same
$ slantwise read thirty-laws-clap
# => - https://news.ycombinator.com/item?id=123...
```

The caching behaviour can be overridden using the `--reroll` flag.

```bash
$ slantwise read thirty-laws-clap
# => - https://news.ycombinator.com/item?id=123...
#                                           ^ old ID

$ slantwise read thirty-laws-clap --reroll
# => - https://news.ycombinator.com/item?id=456...
#                                           ^ new ID 👀
```

Slantwise detects when formula references form a cycle.
To prevent (potentially expensive!) infinite loops, backreferences to in-progress formulas get substituted with an empty "seed" value.
In other words, each node in a cycle is computed at most once.

```bash
$ slantwise create -l ping 'concat("ping ", "temp")'
# => smooth-parks-pump

$ slantwise create -l pong 'concat("pong ", $smooth-parks-pump)'
# => giant-windows-film

$ slantwise update ping --expression 'concat("ping ", $giant-windows-film)'

$ slantwise read ping
# => ping
# => pong
# =>

# Note that results are impacted by which formula is read
$ slantwise read pong
# => pong
# => ping
# =>
```

Use the `trace` command for dependency and seeding information.

```bash
# trace executes formulas like read and accepts the same flags
$ slantwise trace ping --reroll
# => ping (smooth-parks-pump)
# => concat [computed]
# => → "ping \npong \n"
# => ├─ constant
# => │  → "ping "
# => └─ concat [computed]
# =>    → "pong \n"
# =>    ├─ constant
# =>    │  → "pong "
# =>    └─ concat [seed]
# =>       → ""
```

Formulas can be managed using the `list`, `create`, `update`, and `delete` commands, and can be labelled a custom name for CLI usage using the `-p` flag.

## Installation and Setup

The CLI is [available on npm](https://www.npmjs.com/package/slantwise). Install it globally using:

```bash
npm install -g slantwise
```

or try it out with:

```bash
npx slantwise
```

To get started:

1. run `slantwise init` to generate config files
2. open `config.json`
   - on Linux, found in `~/.config/slantwise`
   - on MacOS, found in `~/Library/Preferences/slantwise`
   - on Windows, found in `%APPDATA%\slantwise\Config`
3. update at least one API key:
   - `openaiApiKey` - for OpenAI models
   - `openRouterApiKey` - for OpenRouter models
4. (Optional) use `slantwise models` to see what LLM models are available, or use `slantwise operations` to see valid operations.

A standalone GUI is also available, but might lag behind for feature parity.
The latest version can be found on the [Releases pages](https://github.com/jbarlo/slantwise/releases/latest).

## On the docket (in no particular order)

- file path referencing
- bulk processing
- more model support
- rate-limit aware queueing
- multi-workspace with live file watching
- persisting results as files (rather than purely in db)
- live observability
- parallelized execution
- garbage collection
- global undo/redo
- keybinding support
- loop stepping

## Building from source

1. Install Nix v2.31.0+ from the [Nix Download Page](https://nixos.org/download/)
2. Enable Nix flakes ([NixOS Wiki](https://nixos.wiki/wiki/Flakes))
3. From the repo directory, run `nix develop`
4. Install dependencies by running `just install`
5. Run the associated build command for the interface
   - Electron App: Run `just build {mac|win|linux}` to build for your specific OS, or `just build` to build for all platforms.
   - CLI: Run `just build-cli`

## Development

1. Install Nix v2.31.0+ from the [Nix Download Page](https://nixos.org/download/)
2. Enable Nix flakes ([NixOS Wiki](https://nixos.wiki/wiki/Flakes))
3. From the repo directory, run `nix develop` to enter the nix development environment  
   (Optionally: If you use direnv, run `direnv allow` once to automatically enter the environment when you navigate to the repo directory)
4. Install dependencies by running `just install`
5. Run the development interface with the associated command:
   - Electron App: Run `just dev` to start the Electron dev environment
   - CLI: Run `just cli` to build and run the CLI

To see other frequently useful development commands, run `just`.

## License

Apache 2.0
