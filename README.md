# ZeroNet

**A responsive photo-sharing web app built with React, TypeScript, and Appwrite.**

Share photo posts, discover what others are publishing, and bookmark your favorites. ZeroNet pairs a dark interface with a desktop sidebar and mobile navigation.

**[Open the live demo](https://zeronet.vercel.app/)** · [Features](#features) · [Run locally](#run-locally)

![ZeroNet desktop interface with the photo feed and creator cards](https://github.com/edwardxcj/zeronet/assets/54835538/8fe47cfa-c6d9-4ad8-98e5-cd0c005eaa63)

## Features

- **Publish photos.** Upload a photo with a caption, location, and tags. Edit or delete your own posts.
- **Explore the feed.** Browse recent posts, scroll to load more in Explore, or search by caption.
- **Keep your favorites.** Like posts and bookmark them in a dedicated Saved view.
- **Make it yours.** Sign up with email and password, then customize your name, bio, and avatar.
- **Discover creators.** Browse the People directory and open creator profiles.

## Tech stack

| Area | Tools |
| --- | --- |
| Frontend | React, TypeScript, Vite, React Router |
| UI and forms | Tailwind CSS, Radix UI, React Hook Form, Zod |
| Data fetching | TanStack Query for caching and pagination |
| Backend | Appwrite Authentication, Databases, and Storage |
| Hosting | Vercel |

## Run locally

You will need **Node.js 24.x**, npm, and an Appwrite project. The repository contains the web client; configure the Appwrite resources separately.

```bash
git clone https://github.com/edwardxcj/zeronet.git
cd zeronet
npm ci
```

### Configure Appwrite

Add `localhost` and your deployment hostname as [Appwrite Web platforms](https://appwrite.io/docs/quick-starts/web). Enable email/password sign-in and configure collections for users, posts, and saves, plus a storage bucket for photos and avatars. Match the fields and relationships in the [Appwrite API module](src/lib/appwrite/api.ts). For caption search, add a [full-text index](https://appwrite.io/docs/products/databases/tablesdb/queries#search) on the posts collection's `caption` field.

Create `.env.local` at the repository root and fill in your Appwrite endpoint and resource IDs:

```dotenv
VITE_APPWRITE_URL=https://YOUR_REGION.cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=your-project-id
VITE_APPWRITE_DATABASE_ID=your-database-id
VITE_APPWRITE_STORAGE_ID=your-bucket-id
VITE_APPWRITE_USER_COLLECTION_ID=your-users-collection-id
VITE_APPWRITE_POST_COLLECTION_ID=your-posts-collection-id
VITE_APPWRITE_SAVES_COLLECTION_ID=your-saves-collection-id
```

### Start the app

```bash
npm run dev
```

Open the local URL printed by Vite. To deploy your own instance on Vercel, configure the same environment variables for the deployment.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Type-check and build the site into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run the image URL regression tests |

<details>
<summary>Implementation notes</summary>

- Images are served from Appwrite Storage using original file URLs. The client converts older preview links when reading existing posts and avatars.
- The Follow controls are UI placeholders. Profiles can fail to render when a post has missing likes data.

</details>
