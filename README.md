# Slantwise

A local app to iterate on LLM chains with declarative and reactive formulas. Test your prompt variants quickly and as-needed with a deduplicated cache and lazy evaluation.

> Note: this is super alpha software and the database schema is pretty unstable. Early feedback is welcome but please be aware that there is no guarantee data is transferrable from one version to another.

### Why?
I developed this project partially out of curiosity and partially because it's too slow to prototype LLM wrappers for simple ideas.
A new LLM-friendly problem stares me in the face every other week; CLI agents are great, but sometimes I just want to lock in a flow I found useful.
I found myself wanting the live iteration experience of reactive notebooks with the light syntax ergonomics of https://llm.datasette.io/, all while letting me figure out how the pieces fit together as I went.
Essentially, I wanted Excel but with more space to read.
It's still early, but if you want to prototype workflows with formulas, this is for you!

## Setup

1. start Slantwise to generate config files
2. open `config.json`
    - on Linux, found in `~/.config/slantwise`
    - on MacOS, found in `~/Library/Preferences/slantwise`
    - on Windows, found in `%APPDATA%\slantwise\Config`
3. update `openaiApiKey` to your OpenAI API key, and save
4. restart Slantwise

## Usage

At the moment, the available operations are:

- `llm`
- `getUrlContent`
- `concat`

`llm` behaves like a single conversation turn:

```
llm("hot air balloon", prompt="write me a bedtime story about the topic", model="gpt-4o")
```

Formulas are nestable:

```
llm(
  llm("hot air balloon", prompt="write me a bedtime story about the topic", model="gpt-4o"),
  prompt="rate this bedtime story. 5 star scale",
  model="gpt-4o-mini"
)
```

or chained using pipe operators (this is the same as the above):

```
llm("hot air balloon", prompt="write me a bedtime story about the topic", model="gpt-4o")
|> llm(prompt="write a review for this story",  model="gpt-4o-mini")
```

and chains can get arbitrarily long:

```
llm("hot air balloon", prompt="write me a bedtime story about the topic", model="gpt-4o")
|> llm(prompt="write a review for this story", model="gpt-4o-mini")
|> llm(prompt="give an appropriate 5-point rating that matches this review", model="gpt-4o-mini")
```

`getUrlContent` uses [Jina Reader](https://jina.ai/reader/) to retrieve web content for the given URL in an LLM-friendly format. It's chainable with `llm` for some interesting results:

```
getUrlContent("https://news.ycombinator.com/")
|> llm(prompt="list the links to hardware-related threads", model="gpt-4o")
```

## On the docket (in no particular order)

- file path referencing
- bulk processing
- multi-model support
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
4. Run `just build {mac|win|linux}` to build for your specific OS, or `just build` to build for all platforms.

## Development

1. Install Nix v2.31.0+ from the [Nix Download Page](https://nixos.org/download/)
2. From the repo directory, run `nix develop` to enter the nix development environment  
   (Optionally: If you use direnv, run `direnv allow` once to automatically enter the environment when you navigate to the repo directory)
3. Install dependencies by running `just install`
4. Run `just dev` to start the Electron dev environment

To see other frequently useful development commands, run `just`.

