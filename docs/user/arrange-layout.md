# Arrange layout

Press Cmd+. (Ctrl+. on Windows and Linux), or choose **Arrange layout…** in the command palette,
and describe the layout you want for the thread you are looking at. For example: "browser on
localhost:5173 on the right, terminal below". T3 Code applies the change right away and shows what
it did, with **Undo**. Undo also ends terminals and browser tabs the request started.

It can open a browser, the diff, files or pull requests in the right panel, hide or maximize the
panel, and show, hide, split, resize or add terminals in the drawer or as panel tabs. The right
panel shows one tab at a time, so "browser and diff side by side" opens them as two tabs.

A model plans each request from your words and the current layout. It does not see your code or the
conversation. Recent requests appear under the field, and follow-ups such as "make the terminal
taller" see the earlier requests for that thread until you reload.

The planner uses the environment's text generation model. A fast model such as Claude Haiku or a
[text generator](./text-generation.md) keeps it quick: turn on **Settings → Threads → Layout
assistant model** and pick one.
