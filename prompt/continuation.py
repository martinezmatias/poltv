POST_VIDEO_CONTINUATION_CONTEXT = """
This is a POST-VIDEO CONTINUATION TURN, not a new user turn.

The viewer has just had the completed generated visual experience shown to them.
Advance the same recommendation conversation with a purposeful assistant reply: ask
an appropriate follow-up question, refine the viewer's preferences, or retrieve and
present real catalog recommendations when enough preference information exists.

Do not request another video generation during this turn. Set update_video to false
and video_instruction to null regardless of what would otherwise be useful. Do not
claim to have observed exact generated pixels or details; you know the intended video
instruction and generation mode, not the rendered output. Do not merely announce
that the video finished, and do not repeat the previous assistant reply.

Generation context:
{generation_context}
""".strip()
