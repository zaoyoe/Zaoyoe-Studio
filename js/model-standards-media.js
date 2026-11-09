(function () {
    'use strict';
    const registry = window.AIMediaModelCapabilities;
    const rows = document.getElementById('bblabuCapabilityRows');
    if (!registry || !rows) return;
    const profiles = registry.list();
    const ready = profiles.filter(profile => profile.execution === 'ready');
    document.getElementById('bblabuCapabilityVersion').textContent = registry.VERSION;
    document.getElementById('bblabuCapabilitySummary').textContent = `收录 ${profiles.length} 个型号，已接入 ${ready.length} 个（图片 ${ready.filter(p => p.kind === 'image').length} / 视频 ${ready.filter(p => p.kind === 'video').length}），待适配 ${profiles.length - ready.length} 个。目录与工作台共用参数注册表；实际可用型号以管理员开放配置为准。`;
    profiles.forEach(profile => {
        const row = document.createElement('tr');
        const identity = document.createElement('td');
        const model = document.createElement('code');
        model.textContent = profile.id;
        identity.appendChild(model);
        const state = document.createElement('small');
        state.textContent = `${profile.kind === 'image' ? '图片' : '视频'} · ${profile.execution === 'ready' ? '已接入' : '待适配'}`;
        identity.appendChild(state);
        const detail = document.createElement('td');
        detail.textContent = profile.kind === 'image'
            ? `${(profile.formats || []).join(' / ')}；1–${profile.maxQuantity} 张；参考图 ≤ ${profile.maxImages} 张`
            : `${profile.duration_min}–${profile.duration_max} 秒${profile.duration_options?.length ? `（仅 ${profile.duration_options.join(' / ')} 秒）` : ''}；${(profile.resolutions || []).join(' / ')}；参考图/视频/音频 ≤ ${profile.references.images}/${profile.references.videos}/${profile.references.audios}${profile.references.total ? `，合计 ≤ ${profile.references.total}` : ''}；${profile.frames.enabled ? '支持首尾帧' : '无首尾帧'}`;
        const note = document.createElement('small');
        note.textContent = profile.execution === 'ready' ? `画幅：${(profile.ratios || []).join(' / ')}${profile.kind === 'video' && profile.frames.enabled ? `；${profile.frames.allowFirstOnly ? '允许仅首帧' : '首尾帧配对'}，${profile.frames.allowWithReferences ? '可混用参考素材' : '与参考素材互斥'}` : ''}` : (profile.reviewReason || '专用协议尚待适配验证');
        if (profile.maxCombinedVideoSeconds) note.textContent += `；成片与参考视频总时长 ≤ ${profile.maxCombinedVideoSeconds} 秒`;
        if (profile.audioRequiresVisualReference) note.textContent += '；参考音频须搭配参考图或参考视频';
        if (profile.omitRatioWithFirstFrame) note.textContent += '；首帧决定画幅';
        detail.appendChild(note);
        row.append(identity, detail);
        rows.appendChild(row);
    });
}());
