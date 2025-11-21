# ↗️ Slantwise

A local app to iterate on LLM chains with declarative and reactive formulas. Test your prompt variants quickly and as-needed with a deduplicated cache and lazy evaluation.

> Note: this is super alpha software and the database schema is pretty unstable. Early feedback is welcome but please be aware that there is no guarantee data is transferrable from one version to another.

### Why?

I developed this project partially out of curiosity and partially because it's too slow to prototype LLM wrappers for simple ideas.
A new LLM-friendly problem stares me in the face every other week; CLI agents are great, but sometimes I just want to lock in a flow I found useful.
I found myself wanting the live iteration experience of reactive notebooks with the light syntax ergonomics of https://llm.datasette.io/, all while letting me figure out how the pieces fit together as I went.
Essentially, I wanted Excel but with more space to read.
It's still early, but if you want to prototype workflows with formulas, this is for you!

## Setup

1. run `slantwise init` to generate config files
2. open `config.json`
   - on Linux, found in `~/.config/slantwise`
   - on MacOS, found in `~/Library/Preferences/slantwise`
   - on Windows, found in `%APPDATA%\slantwise\Config`
3. update at least one API key:
   - `openaiApiKey` - for OpenAI models
   - `openRouterApiKey` - for OpenRouter models

## Usage

At the moment, the available operations are:

- `llm`
- `getUrlContent`
- `concat`

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

## On the docket (in no particular order)

- file path referencing
- bulk processing
- more model support
- rate-limit aware queueing
- reforming the development cli to a blessed-path cli
- multi-workspace with live file watching
- persisting results as files (rather than purely in db)
- live observability
- parallelized execution
- garbage collection
- global undo/redo
- keybinding support

## Building from source

1. Install Nix v2.31.0+ from the [Nix Download Page](https://nixos.org/download/)
2. From the repo directory, run `nix develop`
3. Install dependencies by running `just install`
4. Run the associated build command for the interface
   - Electron App: Run `just build {mac|win|linux}` to build for your specific OS, or `just build` to build for all platforms.
   - CLI: Run `just build-cli`

## Development

1. Install Nix v2.31.0+ from the [Nix Download Page](https://nixos.org/download/)
2. From the repo directory, run `nix develop` to enter the nix development environment  
   (Optionally: If you use direnv, run `direnv allow` once to automatically enter the environment when you navigate to the repo directory)
3. Install dependencies by running `just install`
4. Run the development interface with the associated command:
   - Electron App: Run `just dev` to start the Electron dev environment
   - CLI: Run `just cli` to build and run the CLI

To see other frequently useful development commands, run `just`.

## License

Apache 2.0
