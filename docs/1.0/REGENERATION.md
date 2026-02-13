# Regeneration

In 'serve' mode, Ursa watches for file changes and regenerates the site as needed. This regeneration process is designed to be efficient, only updating the parts of the site that are affected by the change, but also as fast as possible to provide a smooth development experience. This process can be quite complex, so it is described in detail here.


# Concepts

## Phases
- Generation Phase
- Regeneration Phase

### Generation Phase
As soon as 'ursa serve' runs, we are in the Generation Phase. In this phase, Ursa generates the entire site from scratch. This is the same process that happens when you run 'ursa build', but with some additional steps to set up the data structures needed for regeneration, and some minor changes to bundling to enhance the development experience (such as skipping minification).

Description of the phase:
- Scan the docroot and build a list of every single file in that tree.
- Scan the meta folder and store templates/etc in memory.
- Create the folder tree in the output folder.
- Copy static assets that require no processing (such as images, webfonts, etc) to the output folder.
  - Document assets (those found in the docroot) go to the same location: for example, "docroot/campaigns/abs/img/pip.png" would be copied to "output/campaigns/abs/img/pip.png".
  - Meta assets (those found in the meta folder, typically only if linked to a template) go to "output/public", after bundling.
- Menu generation:
  - Custom Menus: If a menu.md or menu.txt file is found in any folder of the docroot, it is processed into html, and remembered for inclusion in documents that use this map.
  - Auto-generated Menu: If no menu document is present in a folder, Ursa generates a menu based on the contents of that folder. This menu is not actually written to disk as a file, but is stored in memory and injected into the page when requested by the client.
  - Custom Menus with Auto-generated Content: Menu documents can invoke auto-generation logic and then add custom content. This is a combination of both of the above.
- Document images
  - For each image in the docroot, generate a thumbnail version of it, and copy both original and thumbnail to the output folder.
- Actual documents
  - For each source document (md, mdx, yml, etc), generate the output HTML file and write it to disk. For example, "docroot/campaigns/abs/index.mdx" would be processed and written to "output/campaigns/abs/index.html". 
    - Link any stylesheets, scripts, and images as needed, using the bundled versions if applicable. Embed menus as appropriate, based on the menu generation step above.
    - For document images, the html shows the thumbnail image, but links to the full image (unless a custom link has been defined for that image). The document can specify no thumbnail generation on a per-image basis.
- When every file that should be in the output folder is in the output folder, the Generation Phase is complete. Ursa now listens to file system changes to the docroot and meta folders, and enters the Regeneration Phase.

### Regeneration Phase
In this phase, Ursa is constantly listening for file changes, which create Change Events.

Change Events modify the Validation Matrix.

When there is at least one invalid file in the Validation Matrix, the Regenerator runs. It follows the same logic as the Generation Phase, but isolated to that particular file. Each time a file is regenerated and written to disk, its entry in the Validation Matrix is marked as valid again.

When the Validation Matrix changes, the server checks all Client Subscriptions to see if any of them are ready to refresh, meaning every single one of their source dependencies is valid again. If so, the server sends a message to the client to refresh the page.


## Nouns
- Generator
- Regenerator
- File Watcher
- Validation Matrix Watcher
- Change Event Listener
- Client Subscription Manager

### Generator
The Generator is responsible for the initial generation of the entire site when 'ursa serve' is run. See "Generation Phase" above for a detailed description of its responsibilities.

### Regenerator
The Regenerator is responsible for regenerating individual files as needed when changes are detected. See "Regeneration Phase" above for a detailed description of its responsibilities. It is largely the same code as the Generator, but logically it can be considered a separate entity for the sake of understanding the system. The two will never both exist at the same time.

The Regenerator is a bot that looks at the Validation Matrix, finds invalid files, and follows this logic:
- Find an invalid file.
- Are all of that file's dependencies valid? If not, skip it for now and move on to the next invalid file.
- If all dependencies are valid, regenerate the file, write it to disk, and mark it as valid in the Validation Matrix.
- Repeat until there are no invalid files left in the Validation Matrix, then restart as soon as a new invalid file is detected.

### File Watcher
The File Watcher is responsible for watching the file system for changes to the docroot and meta. This is accomplished using a 3rd party library such as chokidar. (TODO: update this with the correct library)

When a change is detected, the File Watcher creates a Change Event and adds it to the Change Queue.

### Validation Matrix Watcher
The Validation Matrix Watcher is responsible for watching the Validation Matrix for changes. Whenever a file is marked as valid or invalid, this watcher checks all Client Subscriptions to see if any of them are now ready to refresh (meaning all of their source dependencies are valid). If so, it sends a message to the client to refresh the page (possibly proxying via the Client Subscription Manager).

TODO: determine if this bot should handle dependencies, or if the Change Event Listener generates the entire dependency tree.
- Option A: 
  - Change Event Listener knows that file A has been changed. It marks A as invalid. Job done.
  - Validation Matrix Watcher sees that A is invalid. It looks at the Validation Matrix to see if any other files depend on A. If so, it marks them as invalid as well. It continues this process until it has marked all affected files as invalid. This has to be synchronous or lock the matrix, because otherwise the Regenerator could fight over a dependency with the Watcher.
- Option B:
  - Change Event Listener knows that file A has been changed. It marks A as invalid.


## Data Entities
- Dependency Graph
- Validation Matrix
- Change Event / Change Queue
- Client Subscriptions

### Dependency Graph
The Dependency Graph is a data structure that represents the dependencies between files in the docroot and meta.

Each source file (documents, static files, meta files, etc) is a node in the graph. For each node, there is a directional dependency edge pointing to every other node that depends on it. For example, if "index.mdx" references "style.css", there would be an edge from "style.css" to "index.mdx", because "index.mdx" depends on "style.css". This means that if "style.css" changes, we know that "index.mdx" needs to be regenerated.

"Virtual" source files need to be accounted for. For example, the auto-generated menu for a folder doesn't actually exist as a file on disk, but it is still a dependency for any document that uses it. In this case, we can represent the auto-generated menu as a virtual node in the graph, and have edges from that node to any documents that depend on it. Then, if any file in that folder changes (such as adding a new document), we can mark the virtual node as changed, which will trigger regeneration of any documents that depend on it.

This graph is originally created during the Generation Phase, as files are generated and their dependencies are discovered. It can change during the Regeneration Phase as well, if new dependencies are discovered or if files are added or removed. It seems likely that the various watchers and listeners will need to pause when the graph is being updated.

### Validation Matrix
This data structure contains one element for every single output file that can be generated by Ursa for the current docroot. 

The key is TBD. (See below)

Additional values:
- isValid: boolean
- sourcePath: string (the path to the source file that generates this output file, relative to the docs folder; example: "campaigns/abs/index.mdx").
- outputPath: string (the path to the output file, relative to the output folder; example: "campaigns/abs/index.html").
- dependencies: array of other output file paths that this file depends on (for example, an HTML file would depend on the CSS and JS bundles, as well as any images it uses). This is used to determine which files need to be regenerated when a change occurs.

TODO: determine what the key should be.
- Some use cases need to quickly find an entry by its output path.
- Other use cases need to quickly find an entry by its source path.
- Some files don't have 1:1 map between source and output (i.e. bundled assets).

Given the use cases, there's no one perfect key. We'll need an index for at least one set of use cases, but there's no sense in optimizing the key for no use case at all.

Thus, we will use source path as the key, for it's guaranteed to be unique, and many use cases need this.

We can consider adding a secondary index mapping output paths to source paths. There shouldn't be any use cases that change this mapping. Let's think it out:
- No file content change can change the mapping. (right?)
- Moving a source file to a different folder should change the output folder accordingly.
- Swapping foo.mdx for foo.md will change the source path for an unchanging output path.

This analysis is enough to prove that the mapping can change, so we will need to update the secondary index whenever a source file is changed in any way. This is an argument for not having a secondary index at all, but it is still likely worth it for the use cases that require quick lookup by output path.

Question: should changes to this index lock the entire Validation Matrix? If the index is updated in the middle of a regeneration, it could cause some lookups to fail. On the other hand, locking the entire Validation Matrix during index updates could cause a bottleneck if there are many changes happening in quick succession. Could this be solved by having the various processes that may encounter this lock mark their current job as "waiting for index update" and putting it later in their queue?

Who needs to look up by source path?
- Change Mon

### Change Event
A Change Event is created whenever a file change is detected in the docroot or meta folders. It has the following properties:
- sourcePathChanged: string. Example: "docroot/campaigns/abs/index.mdx"
- timestamp: number. Example: 1625247600000 (milliseconds since epoch)

### Change Queue
Change Events are added to the Change Queue as they are created. The structure is an array of Change Events, ordered by timestamp. In theory, no actual sorting should be needed, as new Change Events are added to the end of the array, and completed ones are unshifted. However, to be safe, the queue should be locked while an event is being added or removed, and sorted by timestamp after each addition.

### Client Subscriptions
A Client Subscription is created whenever a client connects to the server using WebSockets (enabled by default when hitting the web server spawned by 'ursa serve'). It has the following properties:
- id: string (unique identifier for the client; TODO: what format? Does the client pick a UUID? Get assigned one by the server? Something else?)
- currentUrl: string.
- sourceDependenciesOfCurrentUrl: array of strings.

#### Current URL
The URL of the page the client is currently on. The thinking is that the user only cares about updates that affect their current page. They don't need a push event for files that they aren't looking at. If the content served on this URL is changed in any way (raw html, a linked or embedded static file, etc), this lets us know to push the update to the client immediately. If they aren't on that url anymore, they don't need a push notification.

#### Source Dependencies of Current URL
This is an array of *source* file paths that the current URL depends on. It is calculated by the server, based on current URL, and changes whenever current URL changes.

Example:
- user is on "campaigns/abs/index.html"
- this URL relies upon:
  - all meta documents for the current template (e.g. meta/templates/default/default.css)
  - the current template's source html (e.g. meta/templates/default/index.html)
  - the source document (e.g. docs/campaigns/abs/index.mdx)
  - any static files referenced directly in the source document (e.g. [./img/pip.png](./img/pip.png) maps to docs/campaigns/abs/img/pip.png)
  - any script.js, style.css, or menu document found in the same folder as the source document; or its parent; or its parent, etc, back to the docroot


TODO: determine the following:
- Should there be a timeout for client subscriptions? Maybe the user opened 50 tabs to their ursa server, but 49 of them haven't been opened in a while. Is there a way to deliver updates to them, which don't process until the tab becomes active?


When the Serve command starts, we are in the Generation Phase; Regeneration cannot happen yet. In the Generation Phase, the Validation Matrix is built. Ursa generates all the files it is supposed to, and for each one, it ensures there is an entry in the Validation Matrix for it, and sets it to true once the file is written to disk. By the end of the Generation Phase, the Validation Matrix should be fully built and all entries should be true.

In the Regeneration Phase, the Validation Matrix's job is simply to hold these true/false values. Changes will change one or more of these values to false, and then the Regenerator will rewrite the files and mark them as true again once written to disk.

### Change Queue
After the Generation Phase, the file system is watched




# Dev Notes

## The Key Issue
Should the various maps use source or output as a key?

- Dependency Graph: source, because dependencies are discovered by looking at the source files.
- Change Event: source, because the file watcher detects changes to source files.
- Client Subscriptions: output, because the client is subscribed to a URL, which maps to an output file.
- Validation Matrix: it depends. Leaning toward output, because source files are never invalid. Validity means 'the output file matches the source file'. For static files, this means the file's contents match and the path is right. For documents, it's quite complicated with many dependencies.

Let's consider the ultimate purpose for each component, based on its preferred key:
- Source:
  - This is all about file changes. File changes can trigger very simple regenerations (one static file), or a total regneration of the entire site (if a template file changes), and anything in between.
  - These updates can and will come in quickly, either by a developer manually saving a file multiple times (oops, typo!), or by bots processing many files.
  - Any one update received during a regeneration can potentially change the entire dependency graph, and thus the entire Validation Matrix. But we can't simply cancel the current change and re-do everything from the new change, because change A may have required regenerations that change B does not! Thus, all changes need to cleanly merge together, even as regeneration continues to run.
- Output:
  - This is all about client subscriptions. Clients are subscribed to output files, and want to know when those output files are updated. They don't care directly about source files, although implicitly there are many source files that affect their current URL. They might just sit on one page for a long time; they might also have 50 tabs open to different pages. They may be quickly navigating the site, changing their currentURL every few seconds, as the site constantly regenerates in the background as they do so. They only need a hot reload if it affects their current page, because all navigation to already generated pages would simply load the regenerated page.
  - The client subscription manager needs to be able to quickly determine which clients are affected by a change, so it can send them the update message as soon as possible. If the key is output, then this lookup is straightforward: we just look at the output file that was changed, and see which clients are subscribed to it. Even if the current URL has 100 dependencies, they all must have an output path, right?
  - *NO!* Here's the obvious: the default template html. While we could say that meta JS/CSS has an output bundle, the 'output file' for the template html is every single html in output that uses that template.
  - Does that mean we could have a one-to-many mapping from source to output? Maybe, but that's not a great data structure for looking things up by *output path*.
  - Couldn't we have both? Source-to-output 1:M and output-to-source 1:1? Best of both worlds, right? Well, no, because every lookup in this system is record-of-truth, not eventual-consistency. If we have two separate maps, we need to ensure that they are always perfectly in sync, which means locking. And the events that can lock this map are both file changes and url changes, both of which can happen quickly and constantly.

All that said, let's try to map out Implementation A with source as the key, and see if everything works.
- Dependency Graph, Validation Matrix, and Change Events all use source as the key. Client Subscriptions use output as the key, but they also have a list of source dependencies for their current URL.
  - Source Dependencies for a URL can be changed by events that happen between Client Subscription begin and a push going out. Thus, this shouldn't be stored; in effect, this is a cache of an ephemeral value that is a function of the dependency graph. Either this should be calculated on demand, or calculated on demand with a cache. So let's remove this property from Client Subscriptions.
- DG changes are triggered by file changes. Some downstream activity needs to pause while DG is being updated; will figure that out later.
- VM is independent of DG; both have the same keys. It's true that adding, deleting, or moving a source file will affect the keys in both, but they'll do so in a deterministic way that should allow for a clean lock-and-update of both.
- CEs are added by the File Watcher; they can either change the DG or VM or both.
  - Step 1: do we need to change the DG? Until we know for sure the answer is no, or until we're done making needed changes, we have to pause the downstream processes (VM updates, Regeneration, and Client Subscription updates).
  - Step 2: DG is done. Great! Now update the VM. If no changes, release the lock immediately; else release lock once VM is updates.
  - Step 3: VM is updated. Great! Regeneration can now continue, assuming there are any invalid files. Also, Client Subscription updates can continue, assuming there are any changes to the output files that clients are subscribed to.