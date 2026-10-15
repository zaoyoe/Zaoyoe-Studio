import { describe, expect, it } from 'vitest';
import {
    translateHcaptchaPrompt,
    formatCaptchaGuideMessage
} from '../human-verification.js';

describe('hCaptcha challenge prompt translation and guidance', () => {
    it('translates animal direction challenge prompts into natural Chinese', () => {
        expect(translateHcaptchaPrompt('Select animals looking away from you'))
            .toBe('请选择背对你（看向别处）的动物');
        expect(translateHcaptchaPrompt('Select all animals looking away from you'))
            .toBe('请选择所有背对你（看向别处）的动物');
        expect(translateHcaptchaPrompt('Please click each image containing an animal looking away from you'))
            .toBe('请点击每张包含背对你（看向别处）动物的图片');
        expect(translateHcaptchaPrompt('Click each image containing an animal looking away from you'))
            .toBe('请点击每张包含背对你（看向别处）动物的图片');
        expect(translateHcaptchaPrompt('Select all animals that do not meet your eye'))
            .toBe('请选择所有背对你（不看向你 / 避开目光）的动物');
        expect(translateHcaptchaPrompt('animals that do not meet your eye'))
            .toBe('背对你（不看向你 / 避开目光）的动物');
    });

    it('translates vehicle and physics property prompts', () => {
        expect(translateHcaptchaPrompt('Tap on each vehicle that is made for water travel'))
            .toBe('请点击能在水上行驶的交通工具（如船只）');
        expect(translateHcaptchaPrompt('Select all objects that can float on water'))
            .toBe('请选择所有能在水上漂浮的物体');
    });

    it('translates spin, liquid absorption, and outdoor/indoor items prompts', () => {
        expect(translateHcaptchaPrompt('Click on things that spin when you use them'))
            .toBe('请点击【使用时会旋转的物品】');
        expect(translateHcaptchaPrompt('Click on all things that spin when you use them'))
            .toBe('请点击【所有使用时会旋转的物品】');
        expect(translateHcaptchaPrompt('things that spin when you use them'))
            .toBe('使用时会旋转的物品');

        expect(translateHcaptchaPrompt('Click on all materials that absorb liquid'))
            .toBe('请点击【所有能吸收液体的材料】');
        expect(translateHcaptchaPrompt('Click on materials that absorb liquid'))
            .toBe('请点击【能吸收液体的材料】');
        expect(translateHcaptchaPrompt('all materials that absorb liquid'))
            .toBe('能吸收液体的材料');

        expect(translateHcaptchaPrompt('Find all items that are typically kept outside'))
            .toBe('请选出所有【通常放置在室外的物品】');
        expect(translateHcaptchaPrompt('items that are typically kept outside'))
            .toBe('通常放置在室外的物品');
        expect(translateHcaptchaPrompt('Find all items that are typically kept indoors'))
            .toBe('请选出所有【通常放置在室内的物品】');
    });

    it('translates difference and drag/matching challenge prompts', () => {
        expect(translateHcaptchaPrompt('Please click on the object that is different from the others'))
            .toBe('请点击与其他物体不同的图案');
        expect(translateHcaptchaPrompt('Please click on the TWO shapes that are different from the others'))
            .toBe('请点击与其他图形不同的【两个形状】');
        expect(translateHcaptchaPrompt('click on the two shapes that are different from the others'))
            .toBe('请点击与其他图形不同的【两个形状】');
        expect(translateHcaptchaPrompt('Please click on the shape that is different from the others'))
            .toBe('请点击与其他图形不同的【形状】');
        expect(translateHcaptchaPrompt('Tap all objects that can be completely concealed by the item shown'))
            .toBe('请选出所有能被所示物品（完全遮蔽）的物体');
        expect(translateHcaptchaPrompt('Please drag the object to complete the pair'))
            .toBe('请拖动目标物体完成配对');
        expect(translateHcaptchaPrompt('drag the matching shape'))
            .toBe('请拖动相匹配的形状');
    });

    it('translates common noun pattern prompts', () => {
        expect(translateHcaptchaPrompt('Click each image containing a bicycle'))
            .toBe('请点击每张包含【自行车】的图片');
        expect(translateHcaptchaPrompt('Select all motorcycles'))
            .toBe('请选择所有【摩托车】');
        expect(translateHcaptchaPrompt('Select all images with living rooms'))
            .toBe('请点击每张包含【客厅】的图片');
        expect(translateHcaptchaPrompt('Click each image containing a guitar'))
            .toBe('请点击每张包含【吉他】的图片');
    });

    it.each([
        'Please click on the TWO ends of the line',
        '  Please  click on the TWO ends of the line.  ',
        'Click both endpoints of the line',
        'Tap on the two end points of the line segment!',
    ])('fully translates the line endpoint prompt: %s', prompt => {
        expect(translateHcaptchaPrompt(prompt)).toBe('请点击线条的两个端点');
    });

    it('preserves already Chinese prompts', () => {
        expect(translateHcaptchaPrompt('请选择背对你的动物'))
            .toBe('请选择背对你的动物');
        expect(translateHcaptchaPrompt('请点击所有包含自行车的图片'))
            .toBe('请点击所有包含自行车的图片');
    });

    it('formats user guidance message to clearly instruct clicking Verify button', () => {
        const msg = formatCaptchaGuideMessage(
            '请选择背对你（看向别处）的动物',
            'Select animals looking away from you'
        );
        expect(msg).not.toContain('【验证题目】');
        expect(msg).toContain('Select animals looking away from you');
        expect(msg).toContain('务必点击右下角的「Verify / 提交」按钮');
    });
});
