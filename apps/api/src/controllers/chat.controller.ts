import { Request, Response, NextFunction } from 'express';
import { ChatService } from '../services/chat.service';
import { ApiResponse } from '../utils/ApiResponse';
import { AccountEventService } from '../services/account-event.service';

export class ChatController {
  static async getAccountEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AccountEventService.list(
        (req as any).user.sub,
        Number(req.query.afterSeq ?? 0),
        Number(req.query.limit ?? 100),
      );
      res.status(200).json(ApiResponse.success(data));
    } catch (error) { next(error); }
  }

  static async saveDeviceCursor(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AccountEventService.saveDeviceCursor(
        (req as any).user.sub,
        String(req.params.matchId),
        req.body.deviceId,
        req.body.eventSeq,
      );
      res.status(200).json(ApiResponse.success(data));
    } catch (error) { next(error); }
  }
  static async completeMediaUpload(req: Request, res: Response, next: NextFunction) {
    try {
      const { ChatMediaService } = require('../services/chat-media.service');
      const data = await ChatMediaService.completeUpload((req as any).user.sub, req.params.matchId, req.params.assetId);
      res.status(200).json(ApiResponse.success(data));
    } catch (error) { next(error); }
  }
  static async getConversations(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const conversations = await ChatService.getConversationsPage(userId, typeof req.query.q === 'string' ? req.query.q : undefined, typeof req.query.cursor === 'string' ? req.query.cursor : undefined, Number(req.query.limit ?? 30));
      res.status(200).json(ApiResponse.success(conversations));
    } catch (error) {
      next(error);
    }
  }

  static async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const matchId = req.params.matchId as string;
      const userId = (req as any).user.sub;
      const cursor = req.query.cursor as string | undefined;
      const since = req.query.since as string | undefined;
      const sinceId = req.query.sinceId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 30;
      const result = await ChatService.getMessages(matchId, userId, cursor, limit, since, sinceId);
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  }

  static async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const matchId = req.params.matchId as string;
      const { content, mediaKey, mediaKeys, clientMessageId, type, metadata, replyToId, storyId } = req.body;
      
      // Additional validation at controller level
      if (mediaKeys && !Array.isArray(mediaKeys)) {
        return res.status(400).json(ApiResponse.error('mediaKeys must be an array'));
      }
      
      if (mediaKeys && mediaKeys.length > 10) {
        return res.status(400).json(ApiResponse.error('Maximum 10 media files per message'));
      }
      
      const message = await ChatService.sendMessage(userId, matchId, content, mediaKey, mediaKeys, clientMessageId, { type, metadata, replyToId, storyId });
      res.status(message.repeated ? 200 : 201).json(ApiResponse.success(message, 'Message sent'));
    } catch (error) {
      if ((error as Error).message.includes('not part of this match')) {
        return res.status(403).json(ApiResponse.error((error as Error).message));
      }
      if ((error as Error).message.includes('required')) {
        return res.status(400).json(ApiResponse.error((error as Error).message));
      }
      next(error);
    }
  }

  static async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const matchId = req.params.matchId as string;
      const result = await ChatService.markAsRead(matchId, userId, req.body?.messageIds);
      res.status(200).json(ApiResponse.success(result, 'Messages marked as read'));
    } catch (error) {
      next(error);
    }
  }

  static async getMediaUploadUrl(req: Request, res: Response, next: NextFunction) {
    try {
      const ObjectChatMediaService = require('../services/chat-media.service').ChatMediaService;
      const userId = (req as any).user.sub;
      const matchId = req.params.matchId as string;
      const ext = req.query.ext as string || 'jpeg';
      
      const payload = await ObjectChatMediaService.generateUploadUrl(userId, matchId, ext);
      res.status(200).json(ApiResponse.success(payload));
    } catch (error) {
      next(error);
    }
  }

  static async getMediaReadUrl(req: Request, res: Response, next: NextFunction) {
    try {
      const ObjectChatMediaService = require('../services/chat-media.service').ChatMediaService;
      const userId = (req as any).user.sub;
      const mediaKey = req.query.key as string;
      
      if (!mediaKey) {
        return res.status(400).json(ApiResponse.error('Missing media key'));
      }
      
      const readUrl = await ObjectChatMediaService.generateReadUrl(userId, mediaKey);
      res.status(200).json(ApiResponse.success(readUrl));
    } catch (error) {
      next(error);
    }
  }

  static async deleteMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const matchId = req.params.matchId as string;
      const messageId = req.params.messageId as string;
      const { mode } = req.body; // 'me' or 'everyone'
      
      await ChatService.deleteMessage(matchId, messageId, userId, mode);

      res.status(200).json(ApiResponse.success({ id: messageId }, 'Message deleted'));
    } catch (error) {
      if ((error as Error).message.includes('Not authorized')) {
        return res.status(403).json(ApiResponse.error((error as Error).message));
      }
      next(error);
    }
  }

  static async updateMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const matchId = req.params.matchId as string;
      const messageId = req.params.messageId as string;
      const { content, expectedRevision } = req.body;
      
      const updated = await ChatService.updateMessage(matchId, messageId, userId, content, expectedRevision);
      res.status(200).json(ApiResponse.success(updated, 'Message updated'));
    } catch (error) {
      if ((error as Error).message.includes('Not authorized') || (error as Error).message.includes('deleted')) {
         return res.status(403).json(ApiResponse.error((error as Error).message));
      }
      next(error);
    }
  }

  static async getEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await ChatService.getEvents(
        (req as any).user.sub,
        String(req.params.matchId),
        Number(req.query.afterSeq ?? 0),
        Number(req.query.limit ?? 100),
      );
      res.status(200).json(ApiResponse.success(data));
    } catch (error) { next(error); }
  }

  static async markDelivered(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await ChatService.markDelivered(String(req.params.matchId), (req as any).user.sub, req.body.messageIds);
      res.status(200).json(ApiResponse.success(data));
    } catch (error) { next(error); }
  }

  static async setReaction(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await ChatService.setReaction(String(req.params.matchId), String(req.params.messageId), (req as any).user.sub, req.body.emoji);
      res.status(200).json(ApiResponse.success(data));
    } catch (error) { next(error); }
  }

  static async setMuted(req: Request, res: Response, next: NextFunction) {
    try {
      const value = req.body.mutedUntil ? new Date(req.body.mutedUntil) : null;
      const data = await ChatService.setMuted(String(req.params.matchId), (req as any).user.sub, value);
      res.status(200).json(ApiResponse.success(data));
    } catch (error) { next(error); }
  }
  static async searchMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await ChatService.searchMessages(String(req.params.matchId), (req as any).user.sub, String(req.query.q ?? ''), Number(req.query.limit ?? 50));
      res.json(ApiResponse.success(data));
    } catch (error) { next(error); }
  }
  static async searchAllMessages(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await ChatService.searchAllMessages((req as any).user.sub, String(req.query.q ?? ''), Number(req.query.limit ?? 50)))); } catch (error) { next(error); }
  }
  static async messageContext(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await ChatService.messageContext(String(req.params.matchId), String(req.params.messageId), (req as any).user.sub))); } catch (error) { next(error); }
  }
}
