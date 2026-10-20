"""Scope moderation to the configured room and preserve administrator access."""
def is_signal_room(chat_id, configured_id, invite_link, legacy_link):
    if configured_id:
        return str(chat_id) == str(configured_id)
    return bool(invite_link) and invite_link == legacy_link


def joined_member(old, new):
    def present(member):
        return member.status in ('member', 'administrator', 'creator') or (
            member.status == 'restricted' and bool(member.is_member))
    return not present(old) and present(new)


async def remove_member(bot, chat_id, user_id):
    member = await bot.get_chat_member(chat_id=chat_id, user_id=user_id)
    if member.status in ('administrator', 'creator') or member.user.is_bot:
        return False
    if member.status == 'kicked':
        await bot.unban_chat_member(chat_id=chat_id, user_id=user_id, only_if_banned=True)
        return True
    if member.status == 'left':
        return True
    await bot.ban_chat_member(chat_id=chat_id, user_id=user_id)
    await bot.unban_chat_member(chat_id=chat_id, user_id=user_id, only_if_banned=True)
    return True
