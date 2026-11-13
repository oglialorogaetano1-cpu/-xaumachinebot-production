import unittest
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock
import signal_room_policy as policy

class PolicyTests(unittest.IsolatedAsyncioTestCase):
    def test_all_links_and_direct_joins_in_correct_room(self):
        for link in ('', 'other', 'legacy'):
            self.assertTrue(policy.is_signal_room(-100, '-100', link, 'legacy'))
            self.assertFalse(policy.is_signal_room(-200, '-100', link, 'legacy'))
    def test_restricted_member_is_tracked(self):
        self.assertTrue(policy.joined_member(NS(status='left'), NS(status='restricted',is_member=True)))
        self.assertFalse(policy.joined_member(NS(status='member'), NS(status='administrator')))
    async def test_admin_and_bot_never_removed(self):
        for status,is_bot in [('administrator',False),('creator',False),('member',True)]:
            bot=AsyncMock();bot.get_chat_member.return_value=NS(status=status,user=NS(is_bot=is_bot))
            self.assertFalse(await policy.remove_member(bot,-100,123))
            bot.ban_chat_member.assert_not_awaited()
    async def test_expired_member_removed_and_can_rejoin(self):
        bot=AsyncMock();bot.get_chat_member.return_value=NS(status='member',user=NS(is_bot=False))
        self.assertTrue(await policy.remove_member(bot,-100,123))
        bot.ban_chat_member.assert_awaited_once_with(chat_id=-100,user_id=123)
        bot.unban_chat_member.assert_awaited_once_with(chat_id=-100,user_id=123,only_if_banned=True)
    async def test_permission_failure_is_not_reported_as_removed(self):
        bot=AsyncMock();bot.get_chat_member.side_effect=RuntimeError()
        with self.assertRaises(RuntimeError):await policy.remove_member(bot,-100,123)
        bot.ban_chat_member.assert_not_awaited()
