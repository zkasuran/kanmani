# Hello World (TypeScript)

This template provides a blank TypeScript workflow example. It aims to give a starting point for writing a workflow from scratch and to get started with local simulation.

Steps to run the example

## 1. Update .env file

You need to add a private key to env file. This is specifically required if you want to simulate chain writes. For that to work the key should be valid and funded.
If your workflow does not do any chain write, generate a throwaway key with `cast wallet new` and use that. Do NOT use a well-known key such as `0x…01`: it exists only to make simulation load, it is publicly known, and leaving it in place once a real write path is wired would sign and broadcast from an address anyone can spend from.
```
CRE_ETH_PRIVATE_KEY=<a throwaway key from `cast wallet new`, never a well-known one>
```

## 2. Install dependencies
```bash
bun install
```

## 3. Simulate the workflow
Run the command from <b>project root directory</b>

```bash
cre workflow simulate <path-to-workflow> --target=staging-settings
```

It is recommended to look into other existing examples to see how to write a workflow. You can generate them by running the `cre init` command.
