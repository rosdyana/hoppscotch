-- CreateTable
CREATE TABLE "AgentConversation" (
    "id" TEXT NOT NULL,
    "userUid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "workspaceType" "WorkspaceType" NOT NULL DEFAULT 'USER',
    "teamID" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdOn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedOn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AgentConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "conversationID" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "provider" TEXT,
    "content" JSONB NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdOn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentConversation_userUid_updatedOn_idx" ON "AgentConversation"("userUid", "updatedOn");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMessage_conversationID_seq_key" ON "AgentMessage"("conversationID", "seq");

-- AddForeignKey
ALTER TABLE "AgentConversation" ADD CONSTRAINT "AgentConversation_userUid_fkey" FOREIGN KEY ("userUid") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_conversationID_fkey" FOREIGN KEY ("conversationID") REFERENCES "AgentConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
