# ASD-STE100-Inspired Agent Quick Reference

## Purpose and scope

Use this guide for coding-agent replies and Markdown documents in `docs/`.
Use it to make software development communication clear, direct, and easy to scan.

This is a project-authored house style. It uses selected ideas from ASD-STE100 Simplified Technical English. It is not the ASD-STE100 standard, a replacement for it, or a formal compliance check.

Do not use this guide to control MedBuddy user-facing text. This includes LINE replies and the prompts or templates that produce those replies.

The full ASD-STE100 standard is copyrighted and stays outside this repository. Request an official copy from the [ASD-STE100 downloads page](https://www.asd-ste100.org/STE_downloads.html).

## Write clear development text

- Start with the result, decision, or current state.
- Use short sentences. Give one main idea in each sentence.
- Use active voice. Name the actor when it helps the reader.
- Use direct verbs: `add`, `remove`, `check`, `create`, `update`, `fail`, and `pass`.
- Put conditions before the action they control.
- State limits, risks, and missing information directly.
- Use lists for procedures, checks, choices, and more than two related items.
- Keep the order of the text the same as the order of the work.
- Use one exact name for each component, command, file, field, and state.
- Define an abbreviation before its first use when the reader may not know it.
- Keep identifiers, commands, paths, API names, and error text exact.

## Prefer simple and direct language

Avoid idioms, filler, vague references, and long noun phrases. Do not use several words when one direct word gives the same meaning.

| Avoid | Prefer |
| --- | --- |
| We have made some changes to the handler. | Updated the webhook handler. |
| It appears that the test is not working correctly. | The test fails. |
| There are a number of items that need attention. | Fix these three items. |
| The service performs validation of the input. | The service validates the input. |
| This may potentially cause a problem later. | This can cause a timeout. |

Use technical terms when they are the accurate name. Explain the term when the reader may not know it. Do not replace a precise term with a vague simple word.

## Use consistent structures

### Code-change summary

State what changed, why it changed, and how you verified it.

> Added retry deduplication to the LINE webhook. It prevents a repeated event from starting a second model turn. `npm test` passes.

### Bug report

State the observed result, the expected result, and the condition that causes the problem.

> A repeated webhook event creates two replies. The system must create one reply. This occurs when LINE retries after a request timeout.

### Plan

State the goal first. List work in execution order. Give each step a clear completion result.

> Goal: prevent duplicate replies after webhook retries.
>
> 1. Store the event identifier before the model call.
> 2. Ignore an event identifier that already exists.
> 3. Add a retry test that proves one reply is sent.

### Technical document

Describe the purpose before implementation detail. Explain inputs, outputs, limits, and failures in a predictable order.

> The webhook adapter verifies the LINE signature before it creates a workspace event. It returns `401` when verification fails. It does not log the raw LINE identifier.

## Final check

Before you send or save development text, check these items:

- Does the first sentence give the reader the result or purpose?
- Does each sentence have one clear main idea?
- Are actions, owners, conditions, and limits clear?
- Are names and technical terms exact and consistent?
- Can a list make the procedure easier to follow?
- Does the text keep MedBuddy user-facing language outside this house style?
